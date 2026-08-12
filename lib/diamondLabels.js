const db = require('../db');

const DEFAULT_AXES = {
  1: ['Troubleshooting', 'OSs', 'Customer Support', 'Operations'],
  2: ['Security', 'AV', 'Network', 'Project Management']
};

const SETTINGS_KEYS = {
  1: 'diamond_1_axes',
  2: 'diamond_2_axes'
};

function parseAxes(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 4) return fallback.slice();
    return parsed.map((label, i) => {
      const text = String(label ?? '').trim();
      return text || fallback[i];
    });
  } catch {
    return fallback.slice();
  }
}

function getDiamondAxes() {
  const axes = {};
  for (const diamond of [1, 2]) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEYS[diamond]);
    axes[diamond] = row
      ? parseAxes(row.value, DEFAULT_AXES[diamond])
      : DEFAULT_AXES[diamond].slice();
  }
  return axes;
}

function setDiamondAxes(diamond, labels) {
  if (![1, 2].includes(Number(diamond))) {
    throw new Error('diamond must be 1 or 2');
  }
  if (!Array.isArray(labels) || labels.length !== 4) {
    throw new Error('labels must be an array of 4 strings');
  }

  const cleaned = labels.map((label, i) => {
    const text = String(label ?? '').trim();
    if (!text) throw new Error(`Axis ${i + 1} label cannot be empty`);
    if (text.length > 40) throw new Error(`Axis ${i + 1} label is too long (max 40 characters)`);
    return text;
  });

  const key = SETTINGS_KEYS[Number(diamond)];
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(cleaned));

  return cleaned;
}

function setAllDiamondAxes(payload) {
  const result = {};
  const tx = db.transaction(() => {
    for (const diamond of [1, 2]) {
      if (payload[diamond] || payload[String(diamond)]) {
        result[diamond] = setDiamondAxes(diamond, payload[diamond] || payload[String(diamond)]);
      } else {
        result[diamond] = getDiamondAxes()[diamond];
      }
    }
  });
  tx();
  return result;
}

module.exports = {
  DEFAULT_AXES,
  getDiamondAxes,
  setDiamondAxes,
  setAllDiamondAxes
};
