const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', '..', 'data', 'rewards.json');

function loadRewards() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function saveRewards(rewards) {
  fs.writeFileSync(FILE, JSON.stringify(rewards, null, 2), 'utf-8');
}

function createReward({ title, pointsCost, description }) {
  const rewards = loadRewards();
  const reward = { id: crypto.randomUUID(), title, pointsCost: Number(pointsCost), description: description || '', active: true };
  rewards.push(reward);
  saveRewards(rewards);
  return reward;
}

function updateReward(id, updates) {
  const rewards = loadRewards();
  const reward = rewards.find((r) => r.id === id);
  if (!reward) return null;
  Object.assign(reward, updates);
  saveRewards(rewards);
  return reward;
}

function deleteReward(id) {
  const rewards = loadRewards();
  const idx = rewards.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  rewards.splice(idx, 1);
  saveRewards(rewards);
  return true;
}

module.exports = { loadRewards, saveRewards, createReward, updateReward, deleteReward };
