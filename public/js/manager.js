/* ============================================================
   Skill Portal — Manager View Logic
   Team overview, individual drill-down, add/remove users,
   team-wide average radar charts
   ============================================================ */

// --- State ---
let teamData = [];
let expandedUserId = null;
let expandCharts = {};
let teamChartD1 = null;
let teamChartD2 = null;

// --- DOM Refs ---
const teamTbody = document.getElementById('team-tbody');
const emptyTeam = document.getElementById('empty-team');
const teamAverages = document.getElementById('team-averages');
const addModal = document.getElementById('add-user-modal');
const toastEl = document.getElementById('toast');

// --- Chart config ---
const DIAMOND_LABELS = {
  1: ['Applications', 'OSs', 'Customer Service', 'Operations'],
  2: ['Security', 'AV', 'Network', 'Proj Mgmt /\nLeadership']
};

const BASE_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: { legend: { display: false } },
  scales: {
    r: {
      min: 0, max: 5, beginAtZero: true,
      ticks: { stepSize: 1, backdropColor: 'transparent', color: '#64748b', font: { size: 10 } },
      pointLabels: { color: '#94a3b8', font: { size: 11, weight: '500', family: 'Inter' } },
      grid: { color: 'rgba(255,255,255,0.06)', circular: true },
      angleLines: { color: 'rgba(255,255,255,0.06)' }
    }
  },
  elements: {
    line: { borderWidth: 2 },
    point: { radius: 3, hoverRadius: 5, borderWidth: 2, backgroundColor: '#111827' }
  }
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  loadTeam();
  setupAddUser();
});

// --- Load Team ---
async function loadTeam() {
  try {
    const res = await fetch('/api/manager/team-overview');
    teamData = await res.json();
    renderTable();
    renderTeamAverages();
  } catch (err) {
    showToast('Failed to load team data', 'error');
  }
}

// --- Render Table ---
function renderTable() {
  if (teamData.length === 0) {
    emptyTeam.style.display = '';
    teamAverages.style.display = 'none';
    teamTbody.innerHTML = '';
    return;
  }

  emptyTeam.style.display = 'none';
  teamTbody.innerHTML = '';

  teamData.forEach(user => {
    // Calculate diamond averages
    const d1Avg = calcDiamondAvg(user.diamond1.current);
    const d2Avg = calcDiamondAvg(user.diamond2.current);
    const overall = user.avgScore ? Number(user.avgScore) : null;

    // Main row
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => toggleExpand(user.id));
    tr.innerHTML = `
      <td><span class="user-name">${escapeHtml(user.display_name)}</span></td>
      <td><span class="role-badge ${user.role}">${user.role}</span></td>
      <td>${escapeHtml(user.team || '—')}</td>
      <td>${scoreBadge(d1Avg)}</td>
      <td>${scoreBadge(d2Avg)}</td>
      <td>${scoreBadge(overall)}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${formatDate(user.lastUpdated)}</td>
      <td>
        <button class="btn btn-danger btn-sm delete-user-btn" data-id="${user.id}" data-name="${escapeHtml(user.display_name)}" title="Remove user">
          ✕
        </button>
      </td>
    `;
    teamTbody.appendChild(tr);

    // Expand row (hidden by default)
    const expandTr = document.createElement('tr');
    expandTr.className = 'expand-row';
    expandTr.id = `expand-${user.id}`;
    expandTr.innerHTML = `
      <td colspan="8">
        <div class="expand-content" id="expand-content-${user.id}">
          <div class="expand-inner">
            <div>
              <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">💎 Diamond 1</h4>
              <div class="expand-chart">
                <canvas id="expand-chart-d1-${user.id}"></canvas>
              </div>
            </div>
            <div>
              <h4 style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">💎 Diamond 2</h4>
              <div class="expand-chart">
                <canvas id="expand-chart-d2-${user.id}"></canvas>
              </div>
            </div>
          </div>
        </div>
      </td>
    `;
    teamTbody.appendChild(expandTr);
  });

  // Wire up delete buttons (stop propagation so row click doesn't fire)
  document.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      if (confirm(`Remove "${name}" and all their skill data?`)) {
        await deleteUser(id);
      }
    });
  });
}

// --- Expand / Collapse ---
function toggleExpand(userId) {
  const content = document.getElementById(`expand-content-${userId}`);
  if (!content) return;

  if (expandedUserId === userId) {
    content.classList.remove('open');
    expandedUserId = null;
    return;
  }

  // Collapse previous
  if (expandedUserId) {
    const prev = document.getElementById(`expand-content-${expandedUserId}`);
    if (prev) prev.classList.remove('open');
  }

  expandedUserId = userId;
  content.classList.add('open');

  // Render charts for this user
  const user = teamData.find(u => u.id === userId);
  if (user) {
    renderExpandCharts(user);
  }
}

function renderExpandCharts(user) {
  [1, 2].forEach(diamond => {
    const canvasId = `expand-chart-d${diamond}-${user.id}`;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Destroy existing chart
    const key = `${user.id}-d${diamond}`;
    if (expandCharts[key]) expandCharts[key].destroy();

    const diamondData = diamond === 1 ? user.diamond1 : user.diamond2;
    const currentSnap = diamondData.current;
    const aimSnap = diamondData.aim;

    const currentVals = currentSnap
      ? [currentSnap.axis_1, currentSnap.axis_2, currentSnap.axis_3, currentSnap.axis_4]
      : [1, 1, 1, 1];
    const aimVals = aimSnap
      ? [aimSnap.axis_1, aimSnap.axis_2, aimSnap.axis_3, aimSnap.axis_4]
      : [1, 1, 1, 1];

    expandCharts[key] = new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels: DIAMOND_LABELS[diamond],
        datasets: [
          {
            label: 'Current',
            data: currentVals,
            backgroundColor: 'rgba(239,68,68,0.15)',
            borderColor: 'rgba(239,68,68,0.9)',
            pointBackgroundColor: '#111827',
            pointBorderColor: '#ef4444'
          },
          {
            label: 'Aim',
            data: aimVals,
            backgroundColor: 'rgba(59,130,246,0.12)',
            borderColor: 'rgba(59,130,246,0.9)',
            pointBackgroundColor: '#111827',
            pointBorderColor: '#3b82f6'
          }
        ]
      },
      options: { ...BASE_CHART_OPTIONS }
    });
  });
}

// --- Team Averages ---
function renderTeamAverages() {
  // Collect all users who have current data
  const usersWithData = teamData.filter(u => u.diamond1.current || u.diamond2.current);

  if (usersWithData.length === 0) {
    teamAverages.style.display = 'none';
    return;
  }

  teamAverages.style.display = '';

  [1, 2].forEach(diamond => {
    const canvasId = diamond === 1 ? 'chart-team-d1' : 'chart-team-d2';
    const ctx = document.getElementById(canvasId).getContext('2d');

    // Calculate averages
    const sums = [0, 0, 0, 0];
    let count = 0;

    usersWithData.forEach(u => {
      const snap = diamond === 1 ? u.diamond1.current : u.diamond2.current;
      if (snap) {
        sums[0] += snap.axis_1;
        sums[1] += snap.axis_2;
        sums[2] += snap.axis_3;
        sums[3] += snap.axis_4;
        count++;
      }
    });

    const avgs = count > 0 ? sums.map(s => +(s / count).toFixed(1)) : [0, 0, 0, 0];

    const chart = diamond === 1 ? teamChartD1 : teamChartD2;
    if (chart) chart.destroy();

    const newChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: DIAMOND_LABELS[diamond],
        datasets: [{
          label: 'Team Average',
          data: avgs,
          backgroundColor: 'rgba(139,92,246,0.15)',
          borderColor: 'rgba(139,92,246,0.9)',
          pointBackgroundColor: '#111827',
          pointBorderColor: '#8b5cf6',
          borderWidth: 2.5
        }]
      },
      options: { ...BASE_CHART_OPTIONS }
    });

    if (diamond === 1) teamChartD1 = newChart;
    else teamChartD2 = newChart;
  });
}

// --- Add User ---
function setupAddUser() {
  const btnAdd = document.getElementById('btn-add-user');
  const btnCancel = document.getElementById('btn-cancel-add');
  const btnConfirm = document.getElementById('btn-confirm-add');
  const inputName = document.getElementById('new-user-name');
  const inputRole = document.getElementById('new-user-role');
  const inputTeam = document.getElementById('new-user-team');

  btnAdd.addEventListener('click', () => {
    addModal.classList.add('visible');
    inputName.value = '';
    inputName.focus();
  });

  btnCancel.addEventListener('click', () => {
    addModal.classList.remove('visible');
  });

  addModal.addEventListener('click', (e) => {
    if (e.target === addModal) addModal.classList.remove('visible');
  });

  btnConfirm.addEventListener('click', async () => {
    const name = inputName.value.trim();
    if (!name) {
      showToast('Please enter a name', 'error');
      return;
    }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: name,
          role: inputRole.value,
          team: inputTeam.value.trim() || 'Support Team'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      addModal.classList.remove('visible');
      showToast(`Added "${name}" to the team!`, 'success');
      await loadTeam();
    } catch (err) {
      showToast('Failed to add user: ' + err.message, 'error');
    }
  });
}

// --- Delete User ---
async function deleteUser(id) {
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    const data = await res.json();
    showToast(data.message, 'success');
    await loadTeam();
  } catch (err) {
    showToast('Failed to remove user', 'error');
  }
}

// --- Helpers ---
function calcDiamondAvg(snap) {
  if (!snap) return null;
  return +((snap.axis_1 + snap.axis_2 + snap.axis_3 + snap.axis_4) / 4).toFixed(1);
}

function scoreBadge(val) {
  if (val === null || val === undefined) return '<span style="color: var(--text-muted);">—</span>';
  let cls = 'score-low';
  if (val >= 3) cls = 'score-mid';
  if (val >= 4) cls = 'score-high';
  return `<span class="score-badge ${cls}">${val}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} visible`;
  setTimeout(() => toastEl.classList.remove('visible'), 3000);
}
