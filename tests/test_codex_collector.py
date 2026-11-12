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
