#!/usr/bin/env python3
"""Read Codex usage metadata, never upload prompts or credentials. Python 3.9+."""
import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

STATE = Path.home() / 'Library/Application Support/AgentBudget'
CONFIG = STATE / 'collector.json'
LABEL = 'com.agentbudget.codex-collector'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
FIELDS = ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def database(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    con = sqlite3.connect(path)
    os.chmod(path, 0o600)
    con.executescript('''
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, offset INTEGER, inode INTEGER, model TEXT);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, session TEXT, model TEXT, time TEXT,
        input INTEGER, cached INTEGER, output INTEGER, reasoning INTEGER);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    ''')
    con.execute("INSERT OR IGNORE INTO settings VALUES ('device', ?)", (uuid.uuid4().hex,))
    con.commit()
    return con


def parse_file(con, path):
    """Incremental newline cursor; event IDs prevent replay/fork/restart duplication."""
    stat = path.stat()
    previous = con.execute('SELECT offset,inode,model FROM files WHERE path=?', (str(path),)).fetchone()
    offset, model = 0, 'unknown'
    if previous and previous[1] == stat.st_ino and previous[0] <= stat.st_size:
        offset, model = previous[0], previous[2]
    with path.open('rb') as stream:
        stream.seek(offset)
        while True:
            start = stream.tell()
            line = stream.readline()
            if not line or not line.endswith(b'\n'):
                offset = start
                break
            offset = stream.tell()
            try:
                event = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(event, dict):
                continue
            payload = event.get('payload')
            if not isinstance(payload, dict):
                continue
            if event.get('type') == 'turn_context':
                candidate = payload.get('model')
                if isinstance(candidate, str) and 0 < len(candidate) <= 100:
                    model = candidate
            if event.get('type') != 'token_usage_record':
                # token_count repeats cumulative totals: NEVER add it to per-response records.
                continue
            usage = payload.get('usage')
            if not isinstance(usage, dict):
                continue
            values = [usage.get(k, 0) for k in FIELDS]
            if any(type(v) is not int or v < 0 or v > 10**12 for v in values):
                continue
            if values[1] > values[0] or values[3] > values[2]:
                continue
            event_time = event.get('timestamp')
            try:
                dt.datetime.fromisoformat(event_time.replace('Z', '+00:00'))
            except (ValueError, TypeError, AttributeError):
                continue
            raw_session = payload.get('thread_id') or payload.get('session_id')
            if not isinstance(raw_session, str):
                continue
            session = hashlib.sha256(raw_session.encode()).hexdigest()[:32]
            raw_id = payload.get('response_id')
            if not isinstance(raw_id, str) or not raw_id:
                # Stable fallback for older records; don't retain provider IDs.
                raw_id = json.dumps([raw_session, event_time, usage], sort_keys=True)
            event_id = hashlib.sha256(raw_id.encode()).hexdigest()
            con.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?)',
                        (event_id, session, model, event_time, *values))
            if model != 'unknown':
                con.execute("UPDATE events SET model=? WHERE id=? AND model='unknown'", (model, event_id))
    con.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?)', (str(path), offset, stat.st_ino, model))
    con.commit()


def collect(con, roots):
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob('*.jsonl')):
            try:
                parse_file(con, path)
            except (OSError, sqlite3.Error):
                con.rollback()
                raise  # Never report a successful refresh after a partial scan.
    sessions = []
    for session, first, last in con.execute('SELECT session,min(time),max(time) FROM events GROUP BY session ORDER BY max(time) DESC LIMIT 2000').fetchall():
        models = []
        for row in con.execute('SELECT model,sum(input),sum(cached),sum(output),sum(reasoning),count(*) FROM events WHERE session=? GROUP BY model', (session,)):
            models.append(dict(zip(('model', 'input_tokens', 'cached_tokens', 'output_tokens', 'reasoning_tokens', 'request_count'), row)))
        sessions.append({'id': session, 'started_at': first, 'last_event_at': last, 'models': models})
    return {'schema_version': 1, 'device_id': con.execute("SELECT value FROM settings WHERE key='device'").fetchone()[0],
            'observed_at': now(), 'sessions': sessions}


def valid_site(site):
    url = urllib.parse.urlparse(site)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('Use the HTTPS origin of your AgentBudget site.')
    return site.rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a collector credential to a redirect destination.


def upload(config, payload):
    endpoint = valid_site(config['site']) + '/api/collector/usage'
    request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'User-Agent': 'AgentBudget-Collector/0.3 (+https://github.com/catherinemao1010/agentbudget)',
        'Authorization': 'Bearer ' + config['token']}, method='POST')
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as result:
        return json.load(result)


def secure_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix('.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f)
    os.chmod(temp, 0o600)
    temp.replace(path)


def run_once(config, con, roots, send=True):
    payload = collect(con, roots)
    if send:
        result = upload(config, payload)
        if not result.get('accepted'):
            raise ValueError('Snapshot was not accepted; check collector clock/configuration.')
    total = sum(m['input_tokens'] + m['output_tokens'] for s in payload['sessions'] for m in s['models'])
    status = {'last_success_at': now(), 'sessions': len(payload['sessions']), 'tokens': total,
              'uploaded': send, 'error': None}
    secure_json(STATE / 'status.json', status)
    print(json.dumps(status), flush=True)
    return payload


def install():
    if sys.platform != 'darwin':
        raise ValueError('Automatic installation currently supports macOS. Use run on other systems.')
    if not CONFIG.exists():
        raise ValueError('Run configure first.')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = STATE / 'collector.py'
    if Path(__file__).resolve() != target.resolve():
        shutil.copyfile(__file__, target)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    document = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(target), 'run'],
                'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 30,
                'StandardOutPath': str(STATE / 'collector.log'), 'StandardErrorPath': str(STATE / 'collector-error.log')}
    PLIST.write_bytes(plistlib.dumps(document))
    subprocess.run(['launchctl', 'bootout', 'gui/' + str(os.getuid()), str(PLIST)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(PLIST)], check=True)
    print('Installed automatic Codex usage collection every 30 seconds at login.')


def connection_from_file(path):
    connection = json.loads(path.read_text())
    site = valid_site(connection['site'])
    token = connection['token']
    if not isinstance(token, str) or not token.startswith('ab_') or len(token) != 67 or any(c not in '0123456789abcdef' for c in token[3:]):
        raise ValueError('Invalid collector key')
    return {'site': site, 'token': token}


def setup_collector(path):
    if sys.platform != 'darwin':
        raise ValueError('Automatic setup currently supports macOS only.')
    if sys.version_info < (3, 9):
        raise ValueError('Install Python 3.9 or newer first.')
    config = connection_from_file(path)
    print('Connect this Mac to: ' + config['site'])
    print('This uploads recorded Codex usage history and future token counts, model names,')
    print('timestamps, and hashed session IDs to the account that created your connection file.')
    print('Prompts, responses, and Codex login credentials stay on this Mac.')
    print('A background service starts at login and checks every 30 seconds while online and awake.')
    print('Check that the dashboard account code matches @AgentBudget before continuing.')
    if input('Enable automatic tracking on this Mac? Type yes to continue: ').strip().lower() != 'yes':
        print('Cancelled. Your existing connection has not changed.')
        return False
    # Stop any existing service before changing accounts. Install restarts it only
    # after a successful first upload, so an invalid key never reports success.
    if PLIST.exists():
        subprocess.run(['launchctl', 'bootout', 'gui/' + str(os.getuid()), str(PLIST)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    codex = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    con = database(STATE / 'usage.sqlite')
    try:
        run_once(config, con, [codex / 'sessions', codex / 'archived_sessions'])
    finally:
        con.close()
    secure_json(CONFIG, config)
    install()
    print('Connected. Ask @AgentBudget for your token usage; no manual sync is needed.')
    print('Remove the downloaded connection JSON now; it contains your private write-only key.')
    print('To stop: python3 "' + str(STATE / 'collector.py') + '" uninstall')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'configure', 'once', 'run', 'status', 'install', 'uninstall'])
    parser.add_argument('--site')
    parser.add_argument('--config-file', type=Path)
    parser.add_argument('--local-only', action='store_true')
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.command == 'setup':
        if not args.config_file:
            parser.error('Download your connection file from Integrations and pass --config-file PATH.')
        try:
            setup_collector(args.config_file)
        except Exception as error:
            message = 'HTTP ' + str(error.code) if isinstance(error, urllib.error.HTTPError) else type(error).__name__
            print('Setup did not complete (' + message + '). Check your connection file, internet access, and Python version; then rerun setup. Background tracking has not been confirmed.', file=sys.stderr)
            raise SystemExit(1)
        return
    if args.command == 'configure':
        if args.config_file:
            connection = connection_from_file(args.config_file)
            site, token = connection['site'], connection['token']
        else:
            site = valid_site(args.site or input('AgentBudget HTTPS site: ').strip())
            token = getpass.getpass('Collector key from Integrations (hidden): ').strip()
        if not token.startswith('ab_') or len(token) != 67 or any(c not in '0123456789abcdef' for c in token[3:]):
            parser.error('Invalid collector key')
        secure_json(CONFIG, {'site': site, 'token': token})
        print('Saved write-only collector key with owner-only file permissions.')
        return
    if args.command == 'install':
        install()
        return
    if args.command == 'uninstall':
        subprocess.run(['launchctl', 'bootout', 'gui/' + str(os.getuid()), str(PLIST)], check=False)
        PLIST.unlink(missing_ok=True)
        print('Stopped collector. Local usage records retained. Revoke its key in Integrations.')
        return
    if args.command == 'status':
        print((STATE / 'status.json').read_text() if (STATE / 'status.json').exists() else 'No collection yet.')
        return
    config = {} if args.local_only else json.loads(CONFIG.read_text())
    con = database(STATE / 'usage.sqlite')
    codex = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    roots = [codex / 'sessions', codex / 'archived_sessions']
    while True:
        try:
            run_once(config, con, roots, send=not args.local_only)
        except Exception as error:
            # Never log tokens, response bodies, prompts, or full filesystem records.
            message = 'HTTP ' + str(error.code) if isinstance(error, urllib.error.HTTPError) else type(error).__name__
            secure_json(STATE / 'status.json', {'last_attempt_at': now(), 'error': message, 'uploaded': False})
            print('Collector retry pending: ' + message, flush=True)
            if args.command == 'once':
                raise SystemExit(1)
        if args.command == 'once':
            break
        time.sleep(30)


if __name__ == '__main__':
    main()
