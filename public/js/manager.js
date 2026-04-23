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
  1: ['Applications', 'OSs', 'Customer Service', 'Operations'],
  2: ['Security', 'AV', 'Network', 'Proj Mgmt /\nLeadership']
};

const BASE_CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  layout: { padding: 25 },
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
          <!-- User Learning Goals below charts -->
          <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 20px;">
            <h4 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 16px;">🎯 User Learning Goals</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
              <div>
                <h5 style="color: var(--text-secondary); margin-bottom: 12px; font-size: 0.95rem;">Diamond 1</h5>
                <div id="expand-todos-d1-${user.id}" style="display: flex; flex-direction: column; gap: 8px;"></div>
              </div>
              <div>
                <h5 style="color: var(--text-secondary); margin-bottom: 12px; font-size: 0.95rem;">Diamond 2</h5>
                <div id="expand-todos-d2-${user.id}" style="display: flex; flex-direction: column; gap: 8px;"></div>
              </div>
            </div>
          </div>

          <!-- Quick Aim Update Panel -->
          <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div>
                <h4 style="font-size: 1.1rem; color: var(--text-primary);">🎯 Set Growth Aims</h4>
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Adjust the target goals for this user. Changes reflect live on the charts above.</p>
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
    await loadUserTodosForExpand(userId);
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

window.updateAimLive = function(userId, diamond, axis, value) {
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

window.saveAimSnapshot = async function(userId) {
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
    listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No tasks assigned.</p>';
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
      <div class="axis-group" style="margin-bottom: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.2);">
        <div class="axis-header" onclick="toggleExpandAxis(${userId}, ${diamond}, ${axis})" style="cursor: pointer; padding: 10px 12px; background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="dropdown-caret" id="expand-caret-${userId}-${diamond}-${axis}" style="display: inline-block; transition: transform 0.3s ease; color: var(--text-muted); font-size: 0.8rem; ${isOpen ? 'transform: rotate(90deg);' : ''}">▶</span>
            <strong style="color: var(--text-primary); font-size: 0.9rem;">${axisName}</strong>
          </div>
          <span style="font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-secondary); padding: 2px 8px; border-radius: 12px; font-weight: 600;">${completedCount} / ${totalCount}</span>
        </div>
        <div class="axis-content" id="expand-axis-content-${userId}-${diamond}-${axis}" style="display: ${isOpen ? 'block' : 'none'}; border-top: 1px solid var(--border-subtle); background: var(--bg-secondary);">
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
          <div class="level-group" style="margin: 6px; border-left: 2px solid ${isLocked ? 'var(--border-subtle)' : 'var(--accent-blue)'}; padding-left: 10px;">
            <h5 style="font-size: 0.8rem; color: ${isLocked ? 'var(--text-muted)' : 'var(--text-primary)'}; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              Level ${l} ${isLocked ? '<span style="font-size: 0.7rem;">(Locked)</span>' : ''}
            </h5>
      `;
      
      html += levelTodos.map(t => {
        const status = t.completion.status || (t.completion.completed ? 'completed' : 'incomplete');
        const isDone = status === 'completed';
        const isAwaiting = status === 'awaiting_approval';
        
        let icon = '<span style="color: var(--text-muted); font-size: 0.8rem;">○</span>';
        let textStyle = '';
        let extraText = '';
        
        if (isAwaiting) {
          icon = '<span style="color: var(--accent-blue); font-weight: bold;">⏳</span>';
          extraText = '<span style="font-size: 0.7rem; color: var(--accent-blue); padding-left: 6px;">(Awaiting Approval)</span>';
        } else if (isDone) {
          icon = '<span style="color: var(--accent-green); font-weight: bold;">✓</span>';
          textStyle = 'text-decoration: line-through; color: var(--text-muted);';
        }

        const action = status === 'completed' ? 'deny' : 'approve';
        
        return `
          <div class="todo-item-row ${isLocked ? 'locked' : ''}" onclick="openManagerLmsModal(${t.id})" style="cursor: pointer; padding: 6px 10px; display: flex; align-items: center; gap: 10px; transition: background 0.2s; border-bottom: 1px solid rgba(255,255,255,0.02); ${isLocked ? 'opacity: 0.5; cursor: not-allowed;' : ''}" ${!isLocked ? 'onmouseover="this.style.background=\'var(--bg-card-hover)\'" onmouseout="this.style.background=\'transparent\'"' : ''}>
            <span class="status-icon-tap" onclick="event.stopPropagation(); if(!${isLocked}) handleQuickApproval(${userId}, ${t.id}, '${action}')" style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; transition: background 0.2s;" onmouseover="if(!${isLocked}) this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
              ${icon}
            </span>
            <span style="color: var(--text-primary); font-size: 0.85rem; font-weight: 500; ${textStyle}">${escapeHtml(t.title)}</span>
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

window.toggleExpandAxis = function(userId, diamond, axis) {
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

window.handleQuickApproval = async function(userId, todoId, action) {
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
      
      const status = activeTodo.completion.status || (activeTodo.completion.completed ? 'completed' : 'incomplete');
      let action = 'approve'; // default to grant
      if (status === 'completed' || status === 'awaiting_approval') {
        action = status === 'completed' ? 'deny' : 'approve';
      }
      
      try {
        btnLmsComplete.disabled = true;
        btnLmsComplete.textContent = 'Processing...';
        
        const res = await fetch('/api/todos/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: expandedUserId, todoId: activeTodo.id, action })
        });
        
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update approval');
        }
        
        showToast(action === 'approve' ? 'Status updated: Completed' : 'Status updated: Revoked', 'success');
        
        await loadUserTodosForExpand(expandedUserId);
        
        const updatedTodo = activeUserTodos.find(x => x.id === activeTodo.id);
        if (updatedTodo) {
          activeTodo = updatedTodo;
          updateManagerLmsButtonState();
        }
        
        await loadTeam();
        
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnLmsComplete.disabled = false;
      }
    });
    managerLmsModalReady = true;
  }
}

window.openManagerLmsModal = function(todoId) {
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
  
  updateManagerLmsButtonState();
  lmsModal.classList.add('visible');
};

function updateManagerLmsButtonState() {
  if (!activeTodo) return;
  const lmsStatus = document.getElementById('lms-status');
  const btnLmsComplete = document.getElementById('btn-lms-complete');
  
  const status = activeTodo.completion.status || (activeTodo.completion.completed ? 'completed' : 'incomplete');
  
  if (status === 'completed') {
    lmsStatus.textContent = 'Status: Completed ✓';
    lmsStatus.style.color = '#10b981'; 
    btnLmsComplete.textContent = 'Revoke Completion ✕';
    btnLmsComplete.className = 'btn btn-secondary';
    btnLmsComplete.style.color = '#ef4444'; 
  } else if (status === 'awaiting_approval') {
    lmsStatus.textContent = 'Status: Awaiting Approval ⏳';
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
    const displayLabel = label.replace('\n', ' ');
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
            <button class="btn btn-danger btn-sm" onclick="deleteTodo(${t.id})" title="Delete Task">✕</button>
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

window.toggleTodoPreview = function(id) {
  if (previewingTodoId === id) {
    previewingTodoId = null;
  } else {
    previewingTodoId = id;
  }
  renderManagerTodos();
};

window.editTodo = function(id) {
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

window.cancelTodoEdit = function() {
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

window.deleteTodo = async function(id) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  try {
    const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete task');
    showToast('Task deleted', 'success');
    await loadManagerTodos();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function setupTodoManager() {
  if (diamondSelect && axisSelect && levelSelect && btnAddTodo) {
    diamondSelect.addEventListener('change', updateAxisLabels);
    axisSelect.addEventListener('change', renderManagerTodos);
    levelSelect.addEventListener('change', renderManagerTodos);
    btnAddTodo.addEventListener('click', addTodo);
    btnCancelTodoEdit.addEventListener('click', cancelTodoEdit);
    
    updateAxisLabels();
    loadManagerTodos();
  }
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
    const axisName = diamondAxes ? String(diamondAxes[p.axis - 1]).replace('\n', ' ') : `Axis ${p.axis}`;
    
    return `
      <div class="card" style="padding: 12px 16px; border-left: 4px solid var(--accent-blue); background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; gap: 16px;">
        <div style="flex: 1;">
          <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; color: var(--text-primary);">
            <span style="color: var(--text-muted); font-weight: normal; margin-right: 8px;">👤 ${escapeHtml(p.display_name)}</span>
            ${escapeHtml(p.title)}
          </h4>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">
            💎 Diamond ${p.diamond} · ${axisName} · Level ${p.level} <br/>
            <span style="color: var(--text-muted);">Requested: ${new Date(p.completed_at).toLocaleString()}</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0;">
          <button class="btn btn-primary btn-sm" onclick="handleApproval(${p.user_id}, ${p.todo_id}, 'approve')">✓ Approve</button>
          <button class="btn btn-secondary btn-sm" onclick="handleApproval(${p.user_id}, ${p.todo_id}, 'deny')" style="color: #ef4444;">✕ Deny</button>
        </div>
      </div>
    `;
  }).join('');
}

window.handleApproval = async function(userId, todoId, action) {
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
