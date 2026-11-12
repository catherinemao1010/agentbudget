import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('collector', Path(__file__).parents[1] / 'scripts/codex-collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def event(response='r1', input=100, cached=20, output=40, reasoning=10):
    return {'type': 'token_usage_record', 'timestamp': '2026-11-11T01:00:00Z', 'payload': {
        'thread_id': 'private-thread-id', 'response_id': response,
        'usage': {'input_tokens': input, 'cached_input_tokens': cached,
                  'output_tokens': output, 'reasoning_output_tokens': reasoning}}}


def write(path, records):
    path.write_text(''.join(json.dumps(r) + '\n' for r in records))


def setup(tmp_path):
    root = tmp_path / 'sessions'
    root.mkdir()
    con = collector.database(tmp_path / 'state.sqlite')
    return root, con


def test_duplicate_response_cumulative_events_and_private_content(tmp_path):
    root, con = setup(tmp_path)
    write(root / 'one.jsonl', [{'type': 'turn_context', 'payload': {'model': 'gpt-test'}},
        {'type': 'response_item', 'payload': {'content': 'PRIVATE PROMPT SECRET'}}, event(), event(),
        {'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'total_tokens': 99999}}}}])
    write(root / 'fork.jsonl', [event()])
    payload = collector.collect(con, [root])
    assert len(payload['sessions']) == 1
    model = payload['sessions'][0]['models'][0]
    assert model == {'model': 'gpt-test', 'input_tokens': 100, 'cached_tokens': 20, 'output_tokens': 40, 'reasoning_tokens': 10, 'request_count': 1}
    assert 'PRIVATE' not in json.dumps(payload)
    assert 'private-thread-id' not in json.dumps(payload)
    assert 'PRIVATE PROMPT SECRET' not in (tmp_path / 'state.sqlite').read_bytes().decode(errors='ignore')


def test_append_partial_line_restart_and_model_change(tmp_path):
    root, con = setup(tmp_path)
    path = root / 'one.jsonl'
    write(path, [event()])
    partial = json.dumps(event('r2'))
    with path.open('a') as f:
        f.write(partial[:30])
    first = collector.collect(con, [root])
    assert first['sessions'][0]['models'][0]['request_count'] == 1
    con.close()
    con = collector.database(tmp_path / 'state.sqlite')
    with path.open('a') as f:
        f.write(partial[30:] + '\n')
        f.write(json.dumps({'type': 'turn_context', 'payload': {'model': 'new-model'}}) + '\n')
        f.write(json.dumps(event('r3')) + '\n')
    payload = collector.collect(con, [root])
    assert sum(m['request_count'] for m in payload['sessions'][0]['models']) == 3
    assert sum(m['input_tokens'] + m['output_tokens'] for m in payload['sessions'][0]['models']) == 420
    again = collector.collect(con, [root])
    assert again['sessions'] == payload['sessions']


def test_truncation_rescan_and_invalid_usage(tmp_path):
    root, con = setup(tmp_path)
    path = root / 'one.jsonl'
    write(path, [event(), event('bad', cached=101), event('bad2', reasoning=41), event('bad3', input=True)])
    collector.collect(con, [root])
    write(path, [event('r2')])
    payload = collector.collect(con, [root])
    assert payload['sessions'][0]['models'][0]['request_count'] == 2


def test_upload_uses_https_origin_only():
    import pytest
    for value in ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?token=secret']:
        with pytest.raises(ValueError):
            collector.valid_site(value)
    assert collector.valid_site('https://example.com/') == 'https://example.com'


def prepare_installer(tmp_path, monkeypatch, consent='yes'):
    state = tmp_path / 'state'
    connection = tmp_path / 'connection.json'
    connection.write_text(json.dumps({'site': 'https://test.example', 'token': 'ab_' + 'a' * 64}))
    monkeypatch.setattr(collector, 'STATE', state)
    monkeypatch.setattr(collector, 'CONFIG', state / 'collector.json')
    monkeypatch.setattr(collector, 'PLIST', tmp_path / 'unused.plist')
    monkeypatch.setattr(collector.sys, 'platform', 'darwin')
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'codex'))
    monkeypatch.setattr('builtins.input', lambda _: consent)
    return connection


def test_setup_requires_opt_in_before_upload_or_install(tmp_path, monkeypatch):
    connection = prepare_installer(tmp_path, monkeypatch, 'no')
    actions = []
    monkeypatch.setattr(collector, 'upload', lambda *args: actions.append('upload'))
    monkeypatch.setattr(collector, 'install', lambda: actions.append('install'))
    assert collector.setup_collector(connection) is False
    assert actions == []
    assert not collector.CONFIG.exists()


def test_setup_verifies_upload_then_installs_private_configuration(tmp_path, monkeypatch):
    connection = prepare_installer(tmp_path, monkeypatch)
    actions = []
    def upload(config, payload):
        assert config['site'] == 'https://test.example'
        assert payload['sessions'] == []
        actions.append('upload')
        return {'accepted': True}
    def install():
        actions.append('install')
        assert json.loads(collector.CONFIG.read_text())['token'] == 'ab_' + 'a' * 64
        assert collector.CONFIG.stat().st_mode & 0o777 == 0o600
    monkeypatch.setattr(collector, 'upload', upload)
    monkeypatch.setattr(collector, 'install', install)
    assert collector.setup_collector(connection) is True
    assert actions == ['upload', 'install']


def test_setup_does_not_install_after_rejected_upload(tmp_path, monkeypatch):
    import pytest
    connection = prepare_installer(tmp_path, monkeypatch)
    installed = []
    monkeypatch.setattr(collector, 'upload', lambda *args: {'accepted': False})
    monkeypatch.setattr(collector, 'install', lambda: installed.append(True))
    with pytest.raises(ValueError):
        collector.setup_collector(connection)
    assert not installed
    assert not collector.CONFIG.exists()


def test_quota_history_daily_and_exact_reset_periods(tmp_path):
    import datetime as dt
    root, con = setup(tmp_path)
    current = dt.datetime.now(dt.timezone.utc)
    reset = current + dt.timedelta(days=3)
    recent = event('recent')
    recent['timestamp'] = (current-dt.timedelta(hours=1)).isoformat()
    old = event('old')
    old['timestamp'] = (current-dt.timedelta(days=10)).isoformat()
    quota = {'type':'event_msg','timestamp':current.isoformat(),'payload':{'type':'token_count',
             'rate_limits':{'limit_id':'codex','primary':{'used_percent':28,'window_minutes':10080,'resets_at':int(reset.timestamp())},
                            'plan_type':'pro','credits':{'balance':'50.5','unlimited':False},'private':'DO NOT UPLOAD'}}}
    write(root/'one.jsonl',[recent,old,quota])
    payload = collector.collect(con,[root])
    a = payload['analytics']
    assert a['quota']['windows'][0]['used_percent'] == 28
    assert a['quota']['credit_balance'] == 50.5
    assert sum(m['input_tokens']+m['output_tokens'] for m in a['periods']['since_reset_primary']['models']) == 140
    assert sum(m['input_tokens']+m['output_tokens'] for d in a['daily'] for m in d['models']) == 280
    assert 'DO NOT UPLOAD' not in json.dumps(a)
    assert 'private-thread-id' not in json.dumps(a)
    collector.collect(con,[root])
    assert con.execute('SELECT count(*) FROM quota_samples').fetchone()[0] == 1


def test_metadata_backfill_preserves_deduplicated_tokens(tmp_path):
    root,con=setup(tmp_path)
    write(root/'one.jsonl',[event()])
    collector.collect(con,[root])
    con.execute("DELETE FROM settings WHERE key='quota_schema'")
    con.commit();con.close()
    con=collector.database(tmp_path/'state.sqlite')
    assert con.execute('SELECT count(*) FROM files').fetchone()[0] == 0
    collector.collect(con,[root])
    assert con.execute('SELECT count(*) FROM events').fetchone()[0] == 1


def test_quota_rejects_invalid_or_unrelated_limits():
    assert collector.clean_quota({'limit_id':'another-service'},'2026-11-12T00:00:00Z') is None
    assert collector.clean_quota({'credits':{'balance':'NaN'}},'2026-11-12T00::00Z') is None
