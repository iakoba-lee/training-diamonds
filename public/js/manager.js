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
    setupSettings();
    setupTodoManager();
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
    expandTr.innerHTML = `
      <td colspan="${colspan}">
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
function toggleExpand(userId) {
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
  if (user) renderExpandCharts(user);
}

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
