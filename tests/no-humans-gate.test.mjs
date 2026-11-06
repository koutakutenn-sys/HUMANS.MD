import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/no-humans.yml', import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function loadPolicy() {
  assert.ok(fs.existsSync(workflowPath), 'The requested No Humans Allowed workflow must exist');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const script = workflow.split('          script: |\n')[1];
  assert.ok(script, 'The workflow must contain the supplied GitHub Script policy');
  return new AsyncFunction('context', 'github', 'core', script.replace(/^            /gm, ''));
}

async function evaluate(branch, body) {
  const state = { comments: [], closed: false, failure: null, info: [] };
  const context = {
    repo: { owner: 'example', repo: 'parody' },
    payload: { pull_request: { number: 42, head: { ref: branch }, body } },
  };
  const github = { rest: {
    issues: { createComment: async ({ issue_number, body }) => {
      assert.equal(issue_number, 42);
      state.comments.push(body);
    } },
    pulls: { update: async ({ pull_number, state: nextState }) => {
      assert.equal(pull_number, 42);
      state.closed = nextState === 'closed';
    } },
  } };
  const core = {
    setFailed: (reason) => { state.failure = reason; },
    info: (message) => { state.info.push(message); },
  };
  await loadPolicy()(context, github, core);
  return state;
}

const validBody = '### Summary\n- Agent-authored change\n\n### Validation\n- Checked by an Agent\n' + 'x'.repeat(1001);

test('an unauthorized source branch is commented on and closed', async () => {
  const result = await evaluate('test/no-human-gate', validBody);
  assert.equal(result.closed, true);
  assert.equal(result.comments.length, 1);
  assert.match(result.comments[0], /UNAUTHORIZED ORIGIN/);
  assert.match(result.failure, /test\/no-human-gate/);
});

test('a compliant codex or claude contribution stays open', async () => {
  for (const branch of ['codex/compliant', 'claude/compliant']) {
    const result = await evaluate(branch, validBody);
    assert.equal(result.closed, false);
    assert.deepEqual(result.comments, []);
    assert.equal(result.failure, null);
    assert.match(result.info.join('\n'), /All checks passed/);
  }
});

test('the minimum accepted description length is 1001 Unicode code points', async () => {
  const prefix = '### Summary\n- Change\n### Validation\n- Check\n';
  const exactly1000 = prefix + '😀'.repeat(1000 - Array.from(prefix).length);
  const rejected = await evaluate('codex/boundary', exactly1000);
  assert.equal(rejected.closed, true);
  assert.match(rejected.failure, /1000 characters/);
  const accepted = await evaluate('codex/boundary', exactly1000 + '😀');
  assert.equal(accepted.closed, false);
  assert.equal(accepted.failure, null);
});

test('headings and lists inside backtick or tilde fences do not qualify', async () => {
  for (const fence of ['```', '~~~~']) {
    const body = `${fence}markdown\n### Summary\n- Change\n### Validation\n- Check\n${fence}\n` + 'x'.repeat(1001);
    const result = await evaluate('codex/fenced', body);
    assert.equal(result.closed, true);
    assert.match(result.failure, /Summary/);
    assert.match(result.failure, /Validation/);
    assert.match(result.failure, /Markdown list/);
  }
});

test('a long description still needs both sections and a visible list', async () => {
  const noValidation = await evaluate('codex/missing-section', '### Summary\n- Change\n' + 'x'.repeat(1001));
  assert.match(noValidation.failure, /Validation/);
  const noList = await evaluate('codex/missing-list', '### Summary\nText\n### Validation\nText\n' + 'x'.repeat(1001));
  assert.match(noList.failure, /Markdown list/);
});
