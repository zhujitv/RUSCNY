import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test('a retained audio retry is bound to its original meeting identity', () => {
  const finish = bodyBetween(
    'function finishRecording(context)',
    'function updateRecordingClock()',
  );
  assert.match(finish, /conversationId: state\.session\?\.conversationId/);
  assert.match(finish, /participantId: state\.participantId/);
  assert.match(finish, /sourceLanguage: state\.session\?\.profile\?\.preferredLanguage/);

  const upload = bodyBetween(
    'async function uploadRecording(upload)',
    'function uploadMatchesCurrentSession(upload)',
  );
  assert.match(upload, /encodeURIComponent\(upload\.conversationId\)/);
  assert.match(upload, /const sourceLanguage = upload\.sourceLanguage/);
  assert.match(upload, /uploadMatchesCurrentSession\(upload\)/);
  assert.doesNotMatch(upload, /encodeURIComponent\(state\.session\.conversationId\)/);
});

test('new joins and terminal navigation invalidate retained uploads', () => {
  for (const [start, end] of [
    ['async function joinAsGuest(event)', 'async function jsonRequest('],
    ['function showTerminal(title, message)', 'function returnToJoin()'],
    ['function returnToJoin()', 'function clearAuthSession()'],
  ]) {
    assert.match(bodyBetween(start, end), /clearPendingUpload\(\)/);
  }
  const clear = bodyBetween(
    'function clearPendingUpload()',
    'async function playTts(',
  );
  assert.match(clear, /uploadGeneration \+= 1/);
  assert.match(clear, /uploadAbortController\?\.abort\(\)/);
});

test('microphone acquisition is singleflight and stale tracks are stopped', () => {
  const start = bodyBetween(
    'function startRecording(fromPointer)',
    'function supportedRecordingFormat()',
  );
  assert.match(start, /state\.recordingStartPromise/);
  assert.match(start, /generation !== state\.recordingGeneration/);
  assert.match(start, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
});

test('server-forced guest refresh disconnect reconnects with the latest token', () => {
  const realtime = bodyBetween(
    'function connectRealtime()',
    'function joinRealtimeRoom(socket)',
  );
  assert.match(realtime, /reason === 'io server disconnect'/);
  assert.match(realtime, /state\.renewPromise/);
  assert.match(realtime, /renewal[\s\S]*\.then\(\(\) =>/);
  assert.match(realtime, /socket\.auth = \{ token: state\.session\?\.accessToken \}/);
  assert.match(realtime, /socket\.connect\(\)/);
  assert.match(realtime, /cancelRecording\(\)/);
});

test('stopping audio invalidates in-flight fetch and playback work', () => {
  const playback = bodyBetween(
    'async function playTts(message, button, retried = false)',
    'async function refreshMessageAudio(message)',
  );
  assert.match(playback, /const generation = state\.audioGeneration/);
  assert.match(playback, /generation !== state\.audioGeneration/g);
  assert.match(playback, /state\.audioGeneration \+= 1/);
});

test('NO_ACCESS_AFTER_END purges transcript and auth session', () => {
  const ended = bodyBetween(
    'async function markMeetingEnded()',
    'function handleRoomError(',
  );
  assert.match(ended, /guestHistoryPolicy === 'NO_ACCESS_AFTER_END'/);
  assert.match(ended, /purgeRoomContent\(\)/);
  assert.match(ended, /clearAuthSession\(\)/);
});

test('non-final translation events are removed from the shared transcript', () => {
  const merge = bodyBetween(
    'function mergeMessage(message, bulk = false)',
    'function reviewStatusRank(value)',
  );
  assert.match(merge, /toUpperCase\(\) !== 'FINAL'/);
  assert.match(merge, /discardMessage\(id\)/);

  const discard = bodyBetween(
    'function discardMessage(id)',
    'function reviewStatusRank(value)',
  );
  assert.match(discard, /state\.messages\.delete\(id\)/);
  assert.match(discard, /card\.remove\(\)/);
  assert.match(discard, /state\.messageElements\.delete\(id\)/);
});
