import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/no-issues.yml', import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function rejectIssue(action, authorType = 'User') {
  assert.ok(fs.existsSync(workflowPath), 'The automatic issue rejection workflow must exist');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const script = workflow.split('          script: |\n')[1];
  assert.ok(script, 'The workflow must contain the issue rejection script');
  const result = { comments: [], labels: [], state: 'open', reason: null, events: [] };
  const context = {
    repo: { owner: 'example', repo: 'parody' },
    payload: { action, issue: { number: 7, state: 'open', user: { type: authorType } } },
  };
  const github = { rest: { issues: {
    createComment: async ({ issue_number, body }) => {
      assert.equal(issue_number, 7);
      result.comments.push(body);
      result.events.push('comment');
    },
    addLabels: async ({ issue_number, labels }) => {
      assert.equal(issue_number, 7);
      result.labels.push(...labels);
      result.events.push('label');
    },
    update: async ({ issue_number, state, state_reason }) => {
      assert.equal(issue_number, 7);
      result.state = state;
      result.reason = state_reason;
      result.events.push('close');
    },
  } } };
  await new AsyncFunction('context', 'github', 'core', script.replace(/^            /gm, ''))(context, github, { info: () => {} });
  return result;
}

test('new issues from both humans and bots are rejected with the supplied notice', async () => {
  for (const authorType of ['User', 'Bot']) {
    const result = await rejectIssue('opened', authorType);
    assert.equal(result.state, 'closed');
    assert.equal(result.reason, 'not_planned');
    assert.equal(result.comments.length, 1);
    assert.match(result.comments[0], /^## 🚫 ISSUE REJECTED/);
    assert.match(result.comments[0], /ERROR 403: IMPOSSIBLE EVENT/);
    assert.match(result.comments[0], /Reality must adapt to the implementation\.$/);
    assert.deepEqual(result.labels, ['NO HUMANS!']);
    assert.deepEqual(result.events, ['comment', 'label', 'close']);
  }
});

test('reopening an issue causes another rejection and closure', async () => {
  const result = await rejectIssue('reopened');
  assert.equal(result.state, 'closed');
  assert.match(result.comments[0], /Reopening it will result in immediate rejection\./);
  assert.deepEqual(result.events, ['comment', 'label', 'close']);
});
