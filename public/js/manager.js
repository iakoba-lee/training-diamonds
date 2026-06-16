/* ============================================================
   Skill Portal — Manager View Logic
   Team overview, individual drill-down, add/edit/remove users,
   team-wide average radar charts, settings panel
   ============================================================ */

// --- State ---
let teamData = [];
let expandedUserId = null;
let expandCharts = {};
let teamChartD1 = null;
let teamChartD2 = null;
let currentRole = null;
let editingUserId = null; // null = adding, number = editing
let activeUserTodos = [];
let activeTodo = null;
let openAxes = {};
let editingReviewId = null; // null = adding, number = editing

// --- DOM Refs ---
const teamTbody = document.getElementById('team-tbody');
const emptyTeam = document.getElementById('empty-team');
const teamAverages = document.getElementById('team-averages');
const modal = document.getElementById('add-user-modal');
const toastEl = document.getElementById('toast');
const navbarRole = document.getElementById('navbar-role');
const btnLogout = document.getElementById('btn-logout');

// --- Chart config ---
const DIAMOND_LABELS = {
  1: ['Applications', 'OSs', ['Customer', 'Service'], 'Operations'],
  2: ['Security', 'AV', 'Network', ['Project', 'Management']]
};

const BASE_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  layout: { padding: 0 },
  plugins: { legend: { display: false } },
  scales: {
    r: {
      min: 0, max: 5, beginAtZero: true,
      ticks: { stepSize: 1, backdropColor: 'transparent', color: '#64748b', font: { size: 10 }, z: 10 },
      pointLabels: { color: '#94a3b8', padding: 5, font: { size: 11, weight: '600', family: 'IBM Plex Sans' } },
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
  // Configure marked for GFM, line breaks, and to open links in a new tab
  const renderer = new marked.Renderer();
  const linkRenderer = renderer.link;
  renderer.link = function() {
    let html = linkRenderer.apply(this, arguments);
    return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
  };

  marked.setOptions({
    gfm: true,
    breaks: true,
    renderer: renderer
  });

  checkAuth();
});

// --- Auth Check ---
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    currentRole = data.role;
    initManagerView();
  } catch (err) {
    window.location.href = '/login';
  }
}

// --- Initialize after auth ---
function initManagerView() {
  // Navbar
  navbarRole.textContent = currentRole === 'manager' ? '⭐ Manager' : '👥 Team';
  navbarRole.className = `navbar-role role-${currentRole}`;

  // Logout
  btnLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Show manager-only controls
  if (currentRole === 'manager') {
    document.getElementById('btn-add-user').classList.remove('hidden');
    document.getElementById('actions-header').classList.remove('hidden');
    document.getElementById('settings-panel').classList.remove('hidden');
    document.getElementById('todo-config').classList.remove('hidden');
    const pendingSection = document.getElementById('pending-approvals-section');
    if (pendingSection) pendingSection.classList.remove('hidden');
    setupSettings();
    setupTodoManager();
    loadPendingApprovals();
  } else {
    // This should be handled by server redirect, but as a backup:
    const navManager = document.getElementById('nav-manager');
    if (navManager) navManager.style.display = 'none';
  }

  loadTeam();
  setupModal();
}

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
    const d1Avg = calcDiamondAvg(user.diamond1.current);
    const d2Avg = calcDiamondAvg(user.diamond2.current);
    const overall = user.avgScore ? Number(user.avgScore) : null;

    // Main row
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => toggleExpand(user.id));

    let actionsHtml = '';
    if (currentRole === 'manager') {
      actionsHtml = `
        <td>
          <div class="action-btns">
            <button class="btn btn-secondary btn-sm edit-user-btn"
                    data-id="${user.id}"
                    data-name="${escapeHtml(user.display_name)}"
                    data-role="${user.role}"
                    data-team="${escapeHtml(user.team || '')}"
                    title="Edit user">
              ✏️
            </button>
            <button class="btn btn-danger btn-sm delete-user-btn"
                    data-id="${user.id}"
                    data-name="${escapeHtml(user.display_name)}"
                    title="Remove user">
              ✕
            </button>
          </div>
        </td>
      `;
    }

    tr.innerHTML = `
      <td><span class="user-name">${escapeHtml(user.display_name)}</span></td>
      <td><span class="role-badge ${user.role}">${user.role}</span></td>
      <td>${escapeHtml(user.team || '—')}</td>
      <td>${scoreBadge(d1Avg)}</td>
      <td>${scoreBadge(d2Avg)}</td>
      <td>${scoreBadge(overall)}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${formatDate(user.lastUpdated)}</td>
      ${actionsHtml}
    `;
    teamTbody.appendChild(tr);

    // Expand row
    const expandTr = document.createElement('tr');
    expandTr.className = 'expand-row';
    expandTr.id = `expand-${user.id}`;
    const colspan = currentRole === 'manager' ? 8 : 7;
    const isExpanded = expandedUserId === user.id;
    expandTr.innerHTML = `
      <td colspan="${colspan}">
        <div class="expand-content ${isExpanded ? 'open' : ''}" id="expand-content-${user.id}">
          <div style="padding: 24px; display: flex; flex-direction: column; gap: 24px;">
            
            <!-- Radar Charts Grid -->
            <div class="charts-grid" style="margin-bottom: 0;">
              <div class="card" style="background: rgba(255,255,255,0.02);">
                <div class="card-header">
                  <div>
                    <div class="card-title">💎 Diamond 1</div>
                    <div class="card-subtitle">Current vs Aim Levels</div>
                  </div>
                </div>
                <div class="chart-container">
                  <canvas id="expand-chart-d1-${user.id}"></canvas>
                </div>
              </div>
              <div class="card" style="background: rgba(255,255,255,0.02);">
                <div class="card-header">
                  <div>
                    <div class="card-title">💎 Diamond 2</div>
                    <div class="card-subtitle">Current vs Aim Levels</div>
                  </div>
                </div>
                <div class="chart-container">
                  <canvas id="expand-chart-d2-${user.id}"></canvas>
                </div>
              </div>
            </div>

            <!-- Learning Goals Grid -->
            <div class="charts-grid" style="margin-bottom: 0;">
              <div class="card" style="background: rgba(255,255,255,0.02);">
                <div class="card-header">
                  <div>
                    <div class="card-title">🎯 Diamond 1 Goals</div>
                    <div class="card-subtitle">Actionable tasks for this user</div>
                  </div>
                </div>
                <div id="expand-todos-d1-${user.id}" style="display: flex; flex-direction: column; gap: 8px;">
                  <!-- Populated by JS -->
                </div>
              </div>
              <div class="card" style="background: rgba(255,255,255,0.02);">
                <div class="card-header">
                  <div>
                    <div class="card-title">🎯 Diamond 2 Goals</div>
                    <div class="card-subtitle">Actionable tasks for this user</div>
                  </div>
                </div>
                <div id="expand-todos-d2-${user.id}" style="display: flex; flex-direction: column; gap: 8px;">
                  <!-- Populated by JS -->
                </div>
              </div>
            </div>

            <!-- Progress Review Section -->
            <div class="card" style="background: rgba(255,255,255,0.02);">
              <div class="card-header" style="margin-bottom: 12px;">
                <div>
                  <div class="card-title">📝 Progress Reviews</div>
                  <div class="card-subtitle">Performance discussions and feedback history</div>
                </div>
                <button class="btn btn-primary btn-sm" onclick="toggleNewReviewForm(${user.id})">
                  + New Review
                </button>
              </div>

              <!-- Collapsible New Review Form -->
              <div id="new-review-form-${user.id}" style="display: none; margin-bottom: 24px; padding: 16px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-subtle);">
                <h5 style="color: var(--text-secondary); margin-bottom: 12px; font-size: 0.9rem;">Add Review Notes</h5>
                <textarea id="review-notes-${user.id}" 
                          style="width: 100%; min-height: 100px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-subtle); border-radius: 6px; color: var(--text-primary); padding: 12px; font-family: inherit; resize: vertical;"
                          placeholder="Type review notes here..."></textarea>
                <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;">
                  <button class="btn btn-secondary btn-sm" onclick="toggleNewReviewForm(${user.id})">Cancel</button>
                  <button class="btn btn-primary btn-sm" onclick="saveProgressReview(${user.id})" id="btn-save-review-${user.id}">
                    💾 Save Review
                  </button>
                </div>
              </div>

              <!-- Past Reviews List -->
              <div id="past-reviews-${user.id}" 
                   class="past-reviews-scroll"
                   style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                <!-- Populated by JS -->
              </div>
            </div>

            <!-- Quick Aim Update Panel -->
            <div class="card" style="background: rgba(255,255,255,0.02);">
              <div class="card-header">
                <div>
                  <div class="card-title">🎯 Set Growth Aims</div>
                  <div class="card-subtitle">Adjust the target goals for this user. Changes reflect live on the charts above.</div>
                </div>
                <span class="save-feedback" id="aim-save-feedback-${user.id}">✓ Saved</span>
              </div>

              <div class="update-grid">
                <!-- Diamond 1 Aims -->
                <div>
                  <h5 style="color: var(--text-secondary); margin-bottom: 12px; font-size: 0.95rem;">Diamond 1 Aims</h5>
                  <div id="aim-sliders-d1-${user.id}"></div>
                </div>
                <!-- Diamond 2 Aims -->
                <div>
                  <h5 style="color: var(--text-secondary); margin-bottom: 12px; font-size: 0.95rem;">Diamond 2 Aims</h5>
                  <div id="aim-sliders-d2-${user.id}"></div>
                </div>
              </div>

              <div style="margin-top: 24px; display: flex; justify-content: center;">
                <button class="btn btn-primary" onclick="saveAimSnapshot(${user.id})" id="btn-save-aim-${user.id}" style="min-width: 180px;">
                  💾 Save Aims
                </button>
              </div>
            </div>
          </div>
        </div>
      </td>
    `;
    teamTbody.appendChild(expandTr);
  });

  // If a user was expanded, re-render their charts/todos to ensure visibility after table refresh
  if (expandedUserId) {
    const user = teamData.find(u => u.id === expandedUserId);
    if (user) {
      renderExpandCharts(user);
      renderUserTodosForExpand(expandedUserId);
      renderAimSliders(user);
      loadUserProgressReviews(expandedUserId);
    }
  }

  // Wire up action buttons (manager only)
  if (currentRole === 'manager') {
    document.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(btn.dataset);
      });
    });

    document.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        showInlineConfirm(e, async () => {
          await deleteUser(id);
        });
      });
    });
  }
}

// --- Expand / Collapse ---
async function toggleExpand(userId) {
  const content = document.getElementById(`expand-content-${userId}`);
  if (!content) return;

  if (expandedUserId === userId) {
    content.classList.remove('open');
    expandedUserId = null;
    return;
  }

  if (expandedUserId) {
    const prev = document.getElementById(`expand-content-${expandedUserId}`);
    if (prev) prev.classList.remove('open');
  }

  expandedUserId = userId;
  content.classList.add('open');

  const user = teamData.find(u => u.id === userId);
  if (user) {
    renderExpandCharts(user);
    await Promise.all([
      loadUserTodosForExpand(userId),
      loadUserProgressReviews(userId)
    ]);
    renderAimSliders(user);
  }
}

function renderAimSliders(user) {
  [1, 2].forEach(diamond => {
    const container = document.getElementById(`aim-sliders-d${diamond}-${user.id}`);
    if (!container) return;

    const diamondData = diamond === 1 ? user.diamond1 : user.diamond2;
    const aimSnap = diamondData.aim || { axis_1: 0, axis_2: 0, axis_3: 0, axis_4: 0 };

    let html = '';
    for (let axis = 1; axis <= 4; axis++) {
      let label = DIAMOND_LABELS[diamond][axis - 1];
      if (Array.isArray(label)) label = label.join(' ');
      const val = aimSnap[`axis_${axis}`] || 0;

      html += `
        <div class="slider-group">
          <div class="slider-label">
            <span>${label.replace('\n', ' ')}</span>
            <span class="slider-value" id="val-aim-d${diamond}-a${axis}-${user.id}">${val}</span>
          </div>
          <input type="range" min="0" max="5" step="1" value="${val}"
                 id="slider-aim-d${diamond}-a${axis}-${user.id}"
                 oninput="updateAimLive(${user.id}, ${diamond}, ${axis}, this.value)">
        </div>
      `;
    }
    container.innerHTML = html;

    // Initial fill for sliders
    container.querySelectorAll('input[type="range"]').forEach(s => updateSliderFill(s));
  });
}

window.updateAimLive = function (userId, diamond, axis, value) {
  const valEl = document.getElementById(`val-aim-d${diamond}-a${axis}-${userId}`);
  if (valEl) valEl.textContent = value;

  const slider = document.getElementById(`slider-aim-d${diamond}-a${axis}-${userId}`);
  if (slider) updateSliderFill(slider);

  // Update chart live
  const key = `${userId}-d${diamond}`;
  const chart = expandCharts[key];
  if (!chart) return;

  const vals = [
    Number(document.getElementById(`slider-aim-d${diamond}-a1-${userId}`).value),
    Number(document.getElementById(`slider-aim-d${diamond}-a2-${userId}`).value),
    Number(document.getElementById(`slider-aim-d${diamond}-a3-${userId}`).value),
    Number(document.getElementById(`slider-aim-d${diamond}-a4-${userId}`).value)
  ];

  // Aim is dataset index 1
  chart.data.datasets[1].data = vals;
  chart.update('none');
};

window.saveAimSnapshot = async function (userId) {
  const btn = document.getElementById(`btn-save-aim-${userId}`);
  const feedback = document.getElementById(`aim-save-feedback-${userId}`);

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const d1Vals = {
      axis_1: Number(document.getElementById(`slider-aim-d1-a1-${userId}`).value),
      axis_2: Number(document.getElementById(`slider-aim-d1-a2-${userId}`).value),
      axis_3: Number(document.getElementById(`slider-aim-d1-a3-${userId}`).value),
      axis_4: Number(document.getElementById(`slider-aim-d1-a4-${userId}`).value)
    };
    const d2Vals = {
      axis_1: Number(document.getElementById(`slider-aim-d2-a1-${userId}`).value),
      axis_2: Number(document.getElementById(`slider-aim-d2-a2-${userId}`).value),
      axis_3: Number(document.getElementById(`slider-aim-d2-a3-${userId}`).value),
      axis_4: Number(document.getElementById(`slider-aim-d2-a4-${userId}`).value)
    };

    const [res1, res2] = await Promise.all([
      fetch(`/api/skills/${userId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diamond: 1, ...d1Vals, snapshot_type: 'aim' })
      }),
      fetch(`/api/skills/${userId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diamond: 2, ...d2Vals, snapshot_type: 'aim' })
      })
    ]);

    if (!res1.ok || !res2.ok) throw new Error('Failed to save aim snapshots');

    showToast('Growth aims updated!', 'success');
    feedback.classList.add('visible');
    setTimeout(() => feedback.classList.remove('visible'), 2000);

    // Refresh data to ensure state is consistent
    await loadTeam();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Aims';
  }
};

function renderExpandCharts(user) {
  [1, 2].forEach(diamond => {
    const canvasId = `expand-chart-d${diamond}-${user.id}`;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const key = `${user.id}-d${diamond}`;
    if (expandCharts[key]) expandCharts[key].destroy();

    const diamondData = diamond === 1 ? user.diamond1 : user.diamond2;
    const currentSnap = diamondData.current;
    const aimSnap = diamondData.aim;

    const currentVals = currentSnap
      ? [currentSnap.axis_1, currentSnap.axis_2, currentSnap.axis_3, currentSnap.axis_4]
      : [0, 0, 0, 0];
    const aimVals = aimSnap
      ? [aimSnap.axis_1, aimSnap.axis_2, aimSnap.axis_3, aimSnap.axis_4]
      : [0, 0, 0, 0];

    expandCharts[key] = new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels: DIAMOND_LABELS[diamond],
        datasets: [
          {
            label: 'Current', data: currentVals,
            backgroundColor: 'rgba(239,68,68,0.15)',
            borderColor: 'rgba(239,68,68,0.9)',
            pointBackgroundColor: '#111827', pointBorderColor: '#ef4444'
          },
          {
            label: 'Aim', data: aimVals,
            backgroundColor: 'rgba(59,130,246,0.12)',
            borderColor: 'rgba(59,130,246,0.9)',
            pointBackgroundColor: '#111827', pointBorderColor: '#3b82f6'
          }
        ]
      },
      options: { ...BASE_CHART_OPTIONS }
    });
  });
}

// --- Drill-down User Goals ---
async function loadUserTodosForExpand(userId) {
  try {
    const res = await fetch(`/api/todos?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to load tasks');
    activeUserTodos = await res.json();
    renderUserTodosForExpand(userId);
  } catch (err) {
    showToast('Failed to load user tasks', 'error');
  }
}

function renderUserTodosForExpand(userId) {
  renderDiamondTodosExpand(1, userId);
  renderDiamondTodosExpand(2, userId);
}

function renderDiamondTodosExpand(diamond, userId) {
  const listEl = document.getElementById(`expand-todos-d${diamond}-${userId}`);
  if (!listEl) return;

  const dTodos = activeUserTodos.filter(t => t.diamond === diamond);
  if (dTodos.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; padding: 24px 0; text-align: center;">No tasks assigned.</p>';
    return;
  }

  const byAxis = { 1: [], 2: [], 3: [], 4: [] };
  dTodos.forEach(t => byAxis[t.axis].push(t));

  let html = '';
  for (let axis = 1; axis <= 4; axis++) {
    if (byAxis[axis].length === 0) continue;

    let label = DIAMOND_LABELS[diamond][axis - 1];
    if (Array.isArray(label)) label = label.join(' ');
    const axisName = label.replace('\n', ' ');

    const axisTodos = byAxis[axis];
    const completedCount = axisTodos.filter(t => t.completion.completed).length;
    const totalCount = axisTodos.length;

    const isOpen = openAxes[`${userId}-${diamond}-${axis}`];

    html += `
      <div class="axis-group" style="margin-bottom: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; background: rgba(0,0,0,0.2);">
        <div class="axis-header" onclick="toggleExpandAxis(${userId}, ${diamond}, ${axis})" 
             style="cursor: pointer; padding: 12px 16px; background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="dropdown-caret" id="expand-caret-${userId}-${diamond}-${axis}" 
                  style="display: inline-block; transition: transform 0.3s ease; color: var(--text-muted); font-size: 0.8rem; ${isOpen ? 'transform: rotate(90deg);' : ''}">▶</span>
            <strong style="color: var(--text-primary); font-size: 0.9rem; letter-spacing: 0.01em;">${axisName}</strong>
          </div>
          <span style="font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-secondary); padding: 4px 10px; border-radius: 12px; font-weight: 600; border: 1px solid var(--border-subtle);">${completedCount} / ${totalCount}</span>
        </div>
        <div class="axis-content" id="expand-axis-content-${userId}-${diamond}-${axis}" 
             style="display: ${isOpen ? 'block' : 'none'}; border-top: 1px solid var(--border-subtle); background: var(--bg-secondary);">
    `;

    const levels = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    axisTodos.forEach(t => {
      const lvl = t.level || 1;
      if (levels[lvl]) levels[lvl].push(t);
    });

    let previousLevelIncomplete = false;
    for (let l = 1; l <= 5; l++) {
      if (levels[l].length === 0) continue;

      const levelTodos = levels[l];
      const isLevelComplete = levelTodos.every(t => t.completion.completed);
      const isLocked = previousLevelIncomplete;

      html += `
          <div class="level-group" style="margin: 10px; border-left: 2px solid ${isLocked ? 'var(--border-subtle)' : 'var(--accent-blue)'}; padding-left: 14px;">
            <h5 style="font-size: 0.8rem; color: ${isLocked ? 'var(--text-muted)' : 'var(--text-primary)'}; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.03em;">
              Level ${l} ${isLocked ? '<span style="font-size: 0.7rem; opacity: 0.7;">(Locked)</span>' : ''}
            </h5>
      `;

      html += levelTodos.map(t => {
        const status = t.completion.status || (t.completion.completed ? 'completed' : 'incomplete');
        const isDone = status === 'completed';
        const isAwaiting = status === 'awaiting_approval';

        let icon = '<span style="color: var(--text-muted); font-size: 0.85rem; opacity: 0.5;">○</span>';
        let textStyle = '';
        let extraText = '';

        if (isAwaiting) {
          icon = '<span style="color: var(--accent-blue); font-weight: bold; filter: drop-shadow(0 0 4px rgba(59,130,246,0.3));">⏳</span>';
          const submittedDate = t.completion.submitted_at ? new Date(t.completion.submitted_at).toLocaleDateString() : '';
          extraText = `<span style="font-size: 0.7rem; color: var(--accent-blue); padding-left: 8px; font-weight: 500;">(Awaiting Approval${submittedDate ? ' · ' + submittedDate : ''})</span>`;
        } else if (isDone) {
          icon = '<span style="color: var(--accent-green); font-weight: bold; filter: drop-shadow(0 0 4px rgba(16,185,129,0.3));">✓</span>';
          textStyle = 'text-decoration: line-through; color: var(--text-muted); opacity: 0.8;';
          const approvedDate = t.completion.completed_at ? new Date(t.completion.completed_at).toLocaleDateString() : '';
          extraText = `<span style="font-size: 0.7rem; color: var(--accent-green); padding-left: 8px; font-weight: 500;">(Approved${approvedDate ? ' · ' + approvedDate : ''})</span>`;
        }

        const action = status === 'completed' ? 'deny' : 'approve';

        return `
          <div class="todo-item-row ${isLocked ? 'locked' : ''}" onclick="openManagerLmsModal(${t.id})" 
               style="cursor: pointer; padding: 8px 12px; display: flex; align-items: center; gap: 12px; transition: all 0.2s; border-bottom: 1px solid rgba(255,255,255,0.03); border-radius: 4px; ${isLocked ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
            <span class="status-icon-tap" onclick="event.stopPropagation(); if(!${isLocked}) handleQuickApproval(${userId}, ${t.id}, '${action}')" 
                  style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; transition: background 0.2s;">
              ${icon}
            </span>
            <span style="color: var(--text-primary); font-size: 0.875rem; font-weight: 500; ${textStyle}">${escapeHtml(t.title)}</span>
            ${extraText}
          </div>
        `;
      }).join('');

      html += `</div>`;
      if (!isLevelComplete) previousLevelIncomplete = true;
    }

    html += `
        </div>
      </div>
    `;
  }
  listEl.innerHTML = html;
}

window.toggleExpandAxis = function (userId, diamond, axis) {
  const el = document.getElementById(`expand-axis-content-${userId}-${diamond}-${axis}`);
  const caret = document.getElementById(`expand-caret-${userId}-${diamond}-${axis}`);
  const key = `${userId}-${diamond}-${axis}`;

  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (caret) caret.style.transform = 'rotate(90deg)';
    openAxes[key] = true;
  } else {
    el.style.display = 'none';
    if (caret) caret.style.transform = 'rotate(0deg)';
    openAxes[key] = false;
  }
};

window.handleQuickApproval = async function (userId, todoId, action) {
  try {
    const res = await fetch('/api/todos/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, todoId, action })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update approval');
    }

    showToast(action === 'approve' ? 'Status updated: Completed' : 'Status updated: Revoked', 'success');

    // Update local state for todos to avoid full reload delay
    await loadUserTodosForExpand(userId);

    // Refresh main team table to update averages/badges (this will now preserve expanded state)
    await loadTeam();

  } catch (err) {
    showToast(err.message, 'error');
  }
};

// --- Drill-down LMS Modal (Manager side) ---
let managerLmsModalReady = false;
function ensureManagerLmsModal() {
  if (managerLmsModalReady) return;
  const lmsModal = document.getElementById('lms-modal');
  const btnLmsClose = document.getElementById('btn-lms-close');
  const btnLmsComplete = document.getElementById('btn-lms-complete');

  if (btnLmsClose && lmsModal) {
    btnLmsClose.addEventListener('click', () => lmsModal.classList.remove('visible'));
    lmsModal.addEventListener('click', (e) => {
      if (e.target === lmsModal) lmsModal.classList.remove('visible');
    });

    btnLmsComplete.addEventListener('click', async () => {
      if (!activeTodo || !expandedUserId) return;

      const status = activeTodo.completion.status || (activeTodo.completion.completed ? "completed" : "incomplete");
      let action = "approve"; // default to grant
      if (status === "completed" || status === "awaiting_approval") {
        action = status === "completed" ? "deny" : "approve";
      }

      try {
        btnLmsComplete.disabled = true;
        btnLmsComplete.textContent = "Processing...";

        const res = await fetch("/api/todos/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: expandedUserId, todoId: activeTodo.id, action })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update approval");
        }

        showToast(action === "approve" ? "Status updated: Completed" : "Status updated: Revoked", "success");

        await loadUserTodosForExpand(expandedUserId);

        const updatedTodo = activeUserTodos.find(x => x.id === activeTodo.id);
        if (updatedTodo) {
          activeTodo = updatedTodo;
          updateManagerLmsButtonState();
        }

        await loadTeam();

      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btnLmsComplete.disabled = false;
      }
    });

    // Tab Switching
    const tabLmsInfo = document.getElementById('tab-lms-info');
    const tabLmsNotes = document.getElementById('tab-lms-notes');
    const paneLmsInfo = document.getElementById('lms-info-pane');
    const paneLmsNotes = document.getElementById('lms-notes-pane');

    tabLmsInfo.addEventListener('click', () => {
      tabLmsInfo.classList.add('active');
      tabLmsNotes.classList.remove('active');
      tabLmsInfo.style.color = 'var(--text-primary)';
      tabLmsInfo.style.borderBottomColor = 'var(--accent-blue)';
      tabLmsNotes.style.color = 'var(--text-muted)';
      tabLmsNotes.style.borderBottomColor = 'transparent';
      paneLmsInfo.style.display = 'block';
      paneLmsNotes.style.display = 'none';
    });

    tabLmsNotes.addEventListener('click', () => {
      tabLmsNotes.classList.add('active');
      tabLmsInfo.classList.remove('active');
      tabLmsNotes.style.color = 'var(--text-primary)';
      tabLmsNotes.style.borderBottomColor = 'var(--accent-blue)';
      tabLmsInfo.style.color = 'var(--text-muted)';
      tabLmsInfo.style.borderBottomColor = 'transparent';
      paneLmsNotes.style.display = 'block';
      paneLmsInfo.style.display = 'none';
    });

    managerLmsModalReady = true;
  }
}

window.openManagerLmsModal = function (todoId) {
  ensureManagerLmsModal();
  const t = activeUserTodos.find(x => x.id === todoId);
  if (!t) return;
  activeTodo = t;

  const lmsModal = document.getElementById('lms-modal');
  const lmsTitle = document.getElementById('lms-title');
  const lmsSubtitle = document.getElementById('lms-subtitle');
  const lmsContent = document.getElementById('lms-content');

  let label = DIAMOND_LABELS[t.diamond][t.axis - 1];
  if (Array.isArray(label)) label = label.join(' ');
  const axisName = label.replace('\n', ' ');

  lmsSubtitle.textContent = `Diamond ${t.diamond} · ${axisName} · Level ${t.level || 1}`;
  lmsTitle.textContent = t.title;
  lmsContent.innerHTML = marked.parse(t.content || '');

  // Populate Notes
  const displayNotes = document.getElementById('lms-user-notes-display');
  if (displayNotes) {
    const notes = (t.completion && t.completion.notes);
    displayNotes.innerHTML = notes ? marked.parse(notes) : '<i style="color: var(--text-muted);">No notes provided by user.</i>';
  }

  // Reset Tab
  document.getElementById('tab-lms-info').click();

  updateManagerLmsButtonState();
  lmsModal.classList.add('visible');
};

function updateManagerLmsButtonState() {
  if (!activeTodo) return;
  const lmsStatus = document.getElementById('lms-status');
  const btnLmsComplete = document.getElementById('btn-lms-complete');

  const status = activeTodo.completion.status || (activeTodo.completion.completed ? 'completed' : 'incomplete');

  if (status === 'completed') {
    const approvedDate = activeTodo.completion.completed_at ? new Date(activeTodo.completion.completed_at).toLocaleDateString() : '';
    lmsStatus.textContent = `Status: Completed ✓ ${approvedDate ? '(' + approvedDate + ')' : ''}`;
    lmsStatus.style.color = '#10b981';
    btnLmsComplete.textContent = 'Revoke Completion ✕';
    btnLmsComplete.className = 'btn btn-secondary';
    btnLmsComplete.style.color = '#ef4444';
  } else if (status === 'awaiting_approval') {
    const submittedDate = activeTodo.completion.submitted_at ? new Date(activeTodo.completion.submitted_at).toLocaleDateString() : '';
    lmsStatus.textContent = `Status: Awaiting Approval ⏳ ${submittedDate ? '(' + submittedDate + ')' : ''}`;
    lmsStatus.style.color = '#3b82f6';
    btnLmsComplete.textContent = 'Grant Completion ✓';
    btnLmsComplete.className = 'btn btn-primary';
    btnLmsComplete.style.color = '';
  } else {
    lmsStatus.textContent = 'Status: Incomplete';
    lmsStatus.style.color = 'var(--text-muted)';
    btnLmsComplete.textContent = 'Grant Completion ✓';
    btnLmsComplete.className = 'btn btn-primary';
    btnLmsComplete.style.color = '';
  }
}

// --- Progress Reviews ---
window.toggleNewReviewForm = function (userId) {
  const form = document.getElementById(`new-review-form-${userId}`);
  if (!form) return;
  
  if (form.style.display === 'block') {
    // Closing
    form.style.display = 'none';
    editingReviewId = null;
    const btn = document.getElementById(`btn-save-review-${userId}`);
    if (btn) btn.textContent = '💾 Save Review';
    const textarea = document.getElementById(`review-notes-${userId}`);
    if (textarea) textarea.value = '';
  } else {
    // Opening
    form.style.display = 'block';
    const textarea = document.getElementById(`review-notes-${userId}`);
    if (textarea) textarea.focus();
  }
};

window.editProgressReview = function (reviewId, userId) {
  const fullTextEl = document.getElementById(`review-full-${reviewId}`);
  if (!fullTextEl) return;
  
  const notes = fullTextEl.textContent.trim();
  const notesEl = document.getElementById(`review-notes-${userId}`);
  const btn = document.getElementById(`btn-save-review-${userId}`);
  const form = document.getElementById(`new-review-form-${userId}`);

  editingReviewId = reviewId;
  notesEl.value = notes;
  btn.textContent = '💾 Update Review';
  
  if (form.style.display === 'none') {
    // Open the form
    form.style.display = 'block';
  }
  notesEl.focus();
  
  // Scroll to form if needed
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.deleteProgressReview = function (event, reviewId, userId) {
  showInlineConfirm(event, async () => {
    try {
      const res = await fetch(`/api/manager/progress-reviews/${reviewId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete review');
      showToast('Review deleted', 'success');
      await loadUserProgressReviews(userId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

window.toggleReviewExpand = function (reviewId) {
  const summary = document.getElementById(`review-summary-${reviewId}`);
  const full = document.getElementById(`review-full-${reviewId}`);
  const caret = document.getElementById(`review-caret-${reviewId}`);

  if (full.style.display === 'none') {
    full.style.display = 'block';
    summary.style.display = 'none';
    if (caret) caret.style.transform = 'rotate(90deg)';
  } else {
    full.style.display = 'none';
    summary.style.display = 'block';
    if (caret) caret.style.transform = 'rotate(0deg)';
  }
};

window.loadUserProgressReviews = async function (userId) {
  const listEl = document.getElementById(`past-reviews-${userId}`);
  if (!listEl) return;

  try {
    const res = await fetch(`/api/manager/progress-reviews/${userId}`);
    if (!res.ok) throw new Error('Failed to load reviews');
    const reviews = await res.json();

    if (reviews.length === 0) {
      listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 24px 0;">No past reviews found.</p>';
      return;
    }

    listEl.innerHTML = reviews.map(r => {
      const dateStr = new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      // Get first few words for summary
      const words = r.notes.trim().split(/\s+/);
      const summaryText = words.slice(0, 10).join(' ') + (words.length > 10 ? '...' : '');

      return `
        <div class="review-item" onclick="toggleReviewExpand(${r.id})" 
             style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 12px; cursor: pointer; transition: background 0.2s;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span id="review-caret-${r.id}" style="display: inline-block; transition: transform 0.2s; font-size: 0.7rem; color: var(--text-muted);">▶</span>
              <strong style="font-size: 0.85rem; color: var(--accent-blue);">${dateStr}</strong>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;" onclick="event.stopPropagation()">
              <span style="font-size: 0.7rem; color: var(--text-muted);">${timeStr}</span>
              <button class="btn btn-secondary btn-sm" onclick="editProgressReview(${r.id}, ${userId})" title="Edit Review" style="padding: 2px 6px; font-size: 0.7rem;">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="deleteProgressReview(event, ${r.id}, ${userId})" title="Delete Review" style="padding: 2px 6px; font-size: 0.7rem;">✕</button>
            </div>
          </div>
          <div id="review-summary-${r.id}" style="font-size: 0.875rem; color: var(--text-secondary); margin-left: 20px;">
            ${escapeHtml(summaryText)}
          </div>
          <div id="review-full-${r.id}" style="display: none; font-size: 0.875rem; color: var(--text-primary); margin-left: 20px; white-space: pre-wrap; line-height: 1.5; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px; margin-top: 8px;">${escapeHtml(r.notes)}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<p style="color: var(--accent-red); font-size: 0.8rem; text-align: center; padding: 12px;">Error loading reviews</p>';
  }
};

window.saveProgressReview = async function (userId) {
  const notesEl = document.getElementById(`review-notes-${userId}`);
  const btn = document.getElementById(`btn-save-review-${userId}`);
  const notes = notesEl.value.trim();

  if (!notes) {
    showToast('Please enter review notes', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = editingReviewId ? 'Updating...' : 'Saving...';

  try {
    const url = editingReviewId 
      ? `/api/manager/progress-reviews/${editingReviewId}` 
      : `/api/manager/progress-reviews/${userId}`;
    const method = editingReviewId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });

    if (!res.ok) throw new Error('Failed to save review');

    showToast(editingReviewId ? 'Review updated!' : 'Progress review saved!', 'success');
    notesEl.value = '';
    
    // Reset editing state
    editingReviewId = null;
    btn.textContent = '💾 Save Review';
    
    toggleNewReviewForm(userId);
    await loadUserProgressReviews(userId);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = editingReviewId ? '💾 Update Review' : '💾 Save Review';
  }
};

// --- Team Averages ---
function renderTeamAverages() {
  const usersWithData = teamData.filter(u => u.diamond1.current || u.diamond2.current);

  if (usersWithData.length === 0) {
    teamAverages.style.display = 'none';
    return;
  }

  teamAverages.style.display = '';

  [1, 2].forEach(diamond => {
    const canvasId = diamond === 1 ? 'chart-team-d1' : 'chart-team-d2';
    const ctx = document.getElementById(canvasId).getContext('2d');

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
          label: 'Team Average', data: avgs,
          backgroundColor: 'rgba(139,92,246,0.15)',
          borderColor: 'rgba(139,92,246,0.9)',
          pointBackgroundColor: '#111827', pointBorderColor: '#8b5cf6',
          borderWidth: 2.5
        }]
      },
      options: { ...BASE_CHART_OPTIONS }
    });

    if (diamond === 1) teamChartD1 = newChart;
    else teamChartD2 = newChart;
  });
}

// --- Add / Edit User Modal ---
function setupModal() {
  const btnAdd = document.getElementById('btn-add-user');
  const btnCancel = document.getElementById('btn-modal-cancel');
  const btnConfirm = document.getElementById('btn-modal-confirm');
  const modalTitle = document.getElementById('modal-title');
  const inputName = document.getElementById('modal-user-name');
  const inputRole = document.getElementById('modal-user-role');
  const inputTeam = document.getElementById('modal-user-team');

  // Open Add modal
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      editingUserId = null;
      modalTitle.textContent = 'Add New User';
      inputName.value = '';
      inputRole.value = 'user';
      inputTeam.value = 'Support Team';
      btnConfirm.textContent = 'Add User';
      modal.classList.add('visible');
      inputName.focus();
    });
  }

  // Cancel
  btnCancel.addEventListener('click', () => modal.classList.remove('visible'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  // Confirm (Add or Edit)
  btnConfirm.addEventListener('click', async () => {
    const name = inputName.value.trim();
    if (!name) {
      showToast('Please enter a name', 'error');
      return;
    }

    try {
      let res;
      if (editingUserId) {
        // Edit existing user
        res = await fetch(`/api/users/${editingUserId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: name,
            role: inputRole.value,
            team: inputTeam.value.trim() || 'Support Team'
          })
        });
      } else {
        // Add new user
        res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: name,
            role: inputRole.value,
            team: inputTeam.value.trim() || 'Support Team'
          })
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      modal.classList.remove('visible');
      const action = editingUserId ? 'Updated' : 'Added';
      showToast(`${action} "${name}"!`, 'success');
      await loadTeam();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    }
  });
}

// Open Edit modal with pre-filled data
function openEditModal(dataset) {
  editingUserId = dataset.id;
  document.getElementById('modal-title').textContent = 'Edit User';
  document.getElementById('modal-user-name').value = dataset.name;
  document.getElementById('modal-user-role').value = dataset.role;
  document.getElementById('modal-user-team').value = dataset.team || 'Support Team';
  document.getElementById('btn-modal-confirm').textContent = 'Save Changes';
  modal.classList.add('visible');
  document.getElementById('modal-user-name').focus();
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

// --- Settings (Manager only) ---
function setupSettings() {
  // Team password
  document.getElementById('btn-save-team-pw').addEventListener('click', async () => {
    const pw = document.getElementById('settings-team-pw').value;
    if (!pw) { showToast('Enter a new team code', 'error'); return; }
    await changePassword('team', pw);
    document.getElementById('settings-team-pw').value = '';
  });

  // Manager password
  document.getElementById('btn-save-manager-pw').addEventListener('click', async () => {
    const pw = document.getElementById('settings-manager-pw').value;
    if (!pw) { showToast('Enter a new manager password', 'error'); return; }
    await changePassword('manager', pw);
    document.getElementById('settings-manager-pw').value = '';
  });
}

async function changePassword(target, newPassword) {
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, newPassword })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    showToast(`${target === 'manager' ? 'Manager' : 'Team'} password updated!`, 'success');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

// --- To-Do Manager ---
const diamondSelect = document.getElementById('todo-diamond-select');
const axisSelect = document.getElementById('todo-axis-select');
const levelSelect = document.getElementById('todo-level-select');
const todoListEl = document.getElementById('manager-todo-list');
const newTitleInput = document.getElementById('todo-new-title');
const newContentInput = document.getElementById('todo-new-content');
const btnAddTodo = document.getElementById('btn-add-todo');
const btnCancelTodoEdit = document.getElementById('btn-cancel-todo-edit');
const todoFormTitle = document.getElementById('todo-form-title');
let managerTodos = [];
let editingTodoId = null; // null = adding, number = editing
let previewingTodoId = null; // Track which todo is currently previewing content

async function loadManagerTodos() {
  try {
    const res = await fetch('/api/todos');
    if (!res.ok) throw new Error('Failed to fetch to-dos');
    managerTodos = await res.json();
    renderManagerTodos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateAxisLabels() {
  if (!axisSelect) return;
  const diamond = Number(diamondSelect.value);
  const labels = DIAMOND_LABELS[diamond];

  axisSelect.innerHTML = labels.map((label, i) => {
    const displayLabel = (Array.isArray(label) ? label.join(' ') : label).replace('\n', ' ');
    return `<option value="${i + 1}">${displayLabel}</option>`;
  }).join('').trim();

  renderManagerTodos();
}

function renderManagerTodos() {
  if (!todoListEl) return;
  const diamond = Number(diamondSelect.value);
  const axis = Number(axisSelect.value);
  const level = Number(levelSelect.value);

  const filtered = managerTodos.filter(t => t.diamond === diamond && t.axis === axis && t.level === level);

  if (filtered.length === 0) {
    todoListEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No tasks configured for this goal yet.</p>';
    return;
  }

  todoListEl.innerHTML = filtered.map(t => {
    const isPreviewing = previewingTodoId === t.id;
    return `
      <div class="todo-item card" style="padding: 12px 16px; border-left: 4px solid var(--accent-blue); background: var(--bg-card); cursor: pointer;" onclick="toggleTodoPreview(${t.id})">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px;">
          <div style="flex: 1;">
            <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-primary);">${escapeHtml(t.title)}</h4>
          </div>
          <div style="display: flex; gap: 8px; flex-shrink: 0;" onclick="event.stopPropagation()">
            <button class="btn btn-secondary btn-sm" onclick="editTodo(${t.id})" title="Edit Task">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteTodo(event, ${t.id})" title="Delete Task">✕</button>
          </div>
        </div>
        ${isPreviewing ? `
          <div class="todo-preview" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-subtle);">
            <div class="markdown-preview" id="lms-content" style="font-size: 0.9rem; color: var(--text-secondary);">
              ${marked.parse(t.content || '')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.toggleTodoPreview = function (id) {
  if (previewingTodoId === id) {
    previewingTodoId = null;
  } else {
    previewingTodoId = id;
  }
  renderManagerTodos();
};

window.editTodo = function (id) {
  const t = managerTodos.find(x => x.id === id);
  if (!t) return;

  editingTodoId = id;
  newTitleInput.value = t.title;
  newContentInput.value = t.content || '';

  todoFormTitle.textContent = 'Edit Task';
  btnAddTodo.textContent = 'Save Changes';
  btnCancelTodoEdit.classList.remove('hidden');

  // Scroll to form
  document.getElementById('todo-form-container').scrollIntoView({ behavior: 'smooth' });
};

window.cancelTodoEdit = function () {
  editingTodoId = null;
  newTitleInput.value = '';
  newContentInput.value = '';

  todoFormTitle.textContent = 'Add New Task';
  btnAddTodo.textContent = 'Add Task';
  btnCancelTodoEdit.classList.add('hidden');
};

async function addTodo() {
  const diamond = Number(diamondSelect.value);
  const axis = Number(axisSelect.value);
  const level = Number(levelSelect.value);
  const title = newTitleInput.value.trim();
  const content = newContentInput.value.trim();

  if (!title) {
    showToast('Task Title is required', 'error');
    return;
  }

  try {
    let res;
    if (editingTodoId) {
      res = await fetch(`/api/todos/${editingTodoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, level })
      });
    } else {
      res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diamond, axis, level, title, content })
      });
    }

    if (!res.ok) throw new Error('Failed to save task');

    const msg = editingTodoId ? 'Task updated!' : 'Task added!';
    cancelTodoEdit();
    showToast(msg, 'success');
    await loadManagerTodos();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.deleteTodo = function (event, id) {
  showInlineConfirm(event, async () => {
    try {
      const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete task');
      showToast('Task deleted', 'success');
      await loadManagerTodos();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

function setupTodoManager() {
  if (diamondSelect && axisSelect && levelSelect && btnAddTodo) {
    diamondSelect.addEventListener('change', updateAxisLabels);
    axisSelect.addEventListener('change', renderManagerTodos);
    levelSelect.addEventListener('change', renderManagerTodos);
    btnAddTodo.addEventListener('click', addTodo);
    btnCancelTodoEdit.addEventListener('click', cancelTodoEdit);

    const btnImportCSV = document.getElementById('btn-import-csv');
    if (btnImportCSV) {
      btnImportCSV.addEventListener('click', handleCSVImport);
    }

    updateAxisLabels();
    loadManagerTodos();
  }
}

function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        row.push("");
      }
    } else if (char === '\r' || char === '\n') {
      if (inQuotes) {
        row[row.length - 1] += char;
      } else {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        lines.push(row);
        row = [""];
      }
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

async function handleCSVImport() {
  const fileInput = document.getElementById('todo-csv-file');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a CSV file first.', 'error');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const text = e.target.result;
      const rows = parseCSV(text);
      
      if (rows.length < 2) {
        throw new Error('CSV file is empty or missing data.');
      }

      // Headers validation
      const headers = rows[0].map(h => h.trim().toLowerCase());
      const colDiamond = headers.indexOf('diamond');
      const colAxis = headers.indexOf('axis');
      const colLevel = headers.indexOf('level');
      const colTitle = headers.indexOf('title');
      const colContent = headers.indexOf('content');

      if (colDiamond === -1 || colAxis === -1 || colLevel === -1 || colTitle === -1) {
        throw new Error("Missing required CSV headers. Must include 'diamond', 'axis', 'level', and 'title'.");
      }

      const todos = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 4 || (row.length === 1 && row[0] === '')) continue; // skip empty rows

        const diamondVal = parseInt(row[colDiamond], 10);
        const axisVal = parseInt(row[colAxis], 10);
        const levelVal = parseInt(row[colLevel], 10);
        const titleVal = row[colTitle] ? row[colTitle].trim() : '';
        const contentVal = colContent !== -1 && row[colContent] ? row[colContent].trim() : '';

        if (isNaN(diamondVal) || isNaN(axisVal) || isNaN(levelVal) || !titleVal) {
          console.warn(`Skipping invalid row ${i + 1}:`, row);
          continue;
        }

        todos.push({
          diamond: diamondVal,
          axis: axisVal,
          level: levelVal,
          title: titleVal,
          content: contentVal
        });
      }

      if (todos.length === 0) {
        throw new Error('No valid rows found in the CSV file.');
      }

      // Send bulk upload
      const res = await fetch('/api/todos/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error during upload');
      }

      const result = await res.json();
      showToast(`Imported successfully! Added ${result.added}, updated ${result.updated} tasks.`, 'success');
      
      // Clear input and reload tasks list
      fileInput.value = '';
      loadManagerTodos();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  reader.readAsText(file);
}


// --- Pending Approvals ---
async function loadPendingApprovals() {
  try {
    const res = await fetch('/api/todos/pending-approvals');
    const pending = await res.json();
    renderPendingApprovals(pending);
  } catch (err) {
    showToast('Failed to load approvals', 'error');
  }
}

function renderPendingApprovals(pending) {
  const listEl = document.getElementById('pending-approvals-list');
  if (!listEl) return;

  if (!pending || pending.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No pending approvals.</p>';
    return;
  }

  listEl.innerHTML = pending.map(p => {
    // Determine Axis name
    const diamondAxes = DIAMOND_LABELS[p.diamond];
    let label = diamondAxes ? diamondAxes[p.axis - 1] : `Axis ${p.axis}`;
    const axisName = (Array.isArray(label) ? label.join(' ') : label).replace('\n', ' ');

    return `
      <div class="card" style="padding: 12px 16px; border-left: 4px solid var(--accent-blue); background: var(--bg-card); flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; width: 100%;">
          <div style="flex: 1;">
            <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; color: var(--text-primary);">
              <span style="color: var(--text-muted); font-weight: normal; margin-right: 8px;">👤 ${escapeHtml(p.display_name)}</span>
              ${escapeHtml(p.title)}
            </h4>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">
              💎 Diamond ${p.diamond} · ${axisName} · Level ${p.level} <br/>
              <span style="color: var(--text-muted);">Submitted: ${new Date(p.submitted_at || p.completed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-shrink: 0;">
            ${p.notes ? `<button class="btn btn-secondary btn-sm" onclick="togglePendingNotes(${p.user_id}, ${p.todo_id})">📝 View Notes</button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="handleApproval(${p.user_id}, ${p.todo_id}, 'approve')">✓ Approve</button>
            <button class="btn btn-secondary btn-sm" onclick="handleApproval(${p.user_id}, ${p.todo_id}, 'deny')" style="color: #ef4444;">✕ Deny</button>
          </div>
        </div>
        ${p.notes ? `
          <div id="pending-notes-${p.user_id}-${p.todo_id}" style="display: none; padding: 16px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 0.95rem; color: var(--text-secondary); width: 100%; line-height: 1.6;">
            <strong style="display: block; margin-bottom: 12px; color: var(--text-primary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">User Notes:</strong>
            <div class="markdown-content">${marked.parse(p.notes)}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.togglePendingNotes = function(userId, todoId) {
  const el = document.getElementById(`pending-notes-${userId}-${todoId}`);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }
};

window.handleApproval = async function (userId, todoId, action) {
  try {
    const res = await fetch('/api/todos/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, todoId, action })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update approval');
    }

    showToast(action === 'approve' ? 'Approved!' : 'Denied', 'success');
    loadPendingApprovals();

    if (action === 'approve') {
      loadTeam(); // Reload team data since their diamond might have updated
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function updateSliderFill(slider) {
  const min = slider.min || 0;
  const max = slider.max || 5;
  const val = slider.value;
  const percent = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--fill-percent', percent + '%');
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

// --- Inline Confirm Popup ---
let currentConfirmCallback = null;
let currentConfirmPopup = null;

function showInlineConfirm(event, callback) {
  event.preventDefault();
  event.stopPropagation();
  
  if (!currentConfirmPopup) {
    currentConfirmPopup = document.createElement('div');
    currentConfirmPopup.className = 'inline-confirm-popup';
    currentConfirmPopup.style.cssText = `
      position: absolute;
      z-index: 10000;
      background: #0f172a;
      border: 1px solid var(--byu-royal, #0057b8);
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.8);
      display: flex;
      gap: 16px;
      align-items: center;
    `;
    
    currentConfirmPopup.innerHTML = `
      <span style="font-size:0.85rem; color:var(--text-primary, #fff); font-weight:500;">Are you sure?</span>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-danger btn-sm" id="inline-confirm-yes" style="padding: 2px 8px; font-size: 0.8rem;">Yes</button>
        <button class="btn btn-secondary btn-sm" id="inline-confirm-no" style="padding: 2px 8px; font-size: 0.8rem;">No</button>
      </div>
    `;
    
    document.body.appendChild(currentConfirmPopup);
    
    document.getElementById('inline-confirm-yes').addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentConfirmCallback) currentConfirmCallback();
      hideInlineConfirm();
    });
    
    document.getElementById('inline-confirm-no').addEventListener('click', (e) => {
      e.stopPropagation();
      hideInlineConfirm();
    });
    
    document.addEventListener('click', (e) => {
      if (currentConfirmPopup && !currentConfirmPopup.contains(e.target) && !e.target.closest('.delete-user-btn') && !e.target.closest('[title="Delete Review"]') && !e.target.closest('[title="Delete Task"]')) {
        hideInlineConfirm();
      }
    });
  }
  
  currentConfirmCallback = callback;
  
  const rect = event.currentTarget.getBoundingClientRect();
  currentConfirmPopup.style.display = 'flex';
  
  const top = rect.top + window.scrollY - 10;
  const left = rect.right + window.scrollX + 10;
  
  currentConfirmPopup.style.top = `${top}px`;
  
  if (left + 200 > window.innerWidth) {
    currentConfirmPopup.style.left = `${rect.left + window.scrollX - 200}px`;
  } else {
    currentConfirmPopup.style.left = `${left}px`;
  }
}

function hideInlineConfirm() {
  if (currentConfirmPopup) {
    currentConfirmPopup.style.display = 'none';
  }
  currentConfirmCallback = null;
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
