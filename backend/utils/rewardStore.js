const crypto = require('crypto');
const kv = require('./kvStore');

const KEY = 'rewards';

async function loadRewards() {
  return kv.getJSON(KEY, []);
}

async function saveRewards(rewards) {
  return kv.setJSON(KEY, rewards);
}

async function createReward({ title, pointsCost, description }) {
  const rewards = await loadRewards();
  const reward = { id: crypto.randomUUID(), title, pointsCost: Number(pointsCost), description: description || '', active: true };
  rewards.push(reward);
  await saveRewards(rewards);
  return reward;
}

async function updateReward(id, updates) {
  const rewards = await loadRewards();
  const reward = rewards.find((r) => r.id === id);
  if (!reward) return null;
  Object.assign(reward, updates);
  await saveRewards(rewards);
  return reward;
}

async function deleteReward(id) {
  const rewards = await loadRewards();
  const idx = rewards.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  rewards.splice(idx, 1);
  await saveRewards(rewards);
  return true;
}

module.exports = { loadRewards, saveRewards, createReward, updateReward, deleteReward };
