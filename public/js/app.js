/* ============================================================
   Skill Portal — Dashboard Logic
   Handles auth, user picker, radar charts, sliders, and saving
   ============================================================ */

// --- State ---
let currentUserId = null;
let snapshotType = 'current'; // 'current' or 'aim'
let chartD1 = null;
let chartD2 = null;
let latestData = null;
let currentRole = null; // 'team' or 'manager'
let userTodos = [];
let activeTodo = null;
let openAxes = {}; // Track which diamond-axis dropdowns are open
let teamChartD1 = null;
let teamChartD2 = null;

// --- DOM Refs ---
const userSelect = document.getElementById('user-select');
const emptyState = document.getElementById('empty-state');
const dashboardContent = document.getElementById('dashboard-content');
const toastEl = document.getElementById('toast');
const navbarRole = document.getElementById('navbar-role');
const btnLogout = document.getElementById('btn-logout');

// --- Chart Configuration ---
const DIAMOND_LABELS = {
  1: ['Applications', 'OSs', ['Customer', 'Service'], 'Operations'],
  2: ['Security', 'AV', 'Network', ['Project', 'Management']]
};

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  layout: {
    padding: 0
  },
  plugins: {
    legend: { display: false }
  },
  scales: {
    r: {
      min: 0,
      max: 5,
      beginAtZero: true,
      ticks: {
        stepSize: 1,
        backdropColor: 'transparent',
        color: '#64748b',
        font: { size: 10 },
        z: 10
      },
      pointLabels: {
        color: '#94a3b8',
        padding: 5,
        font: { size: 11, weight: '600', family: 'IBM Plex Sans' }
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.06)',
        circular: true
      },
      angleLines: {
        color: 'rgba(255, 255, 255, 0.06)'
      }
    }
  },
  elements: {
    line: { borderWidth: 2 },
    point: {
      radius: 4,
      hoverRadius: 6,
      borderWidth: 2,
      backgroundColor: '#111827'
    }
  }
};

function makeDatasets(currentData, aimData) {
  return [
    {
      label: 'Current',
      data: currentData || [0, 0, 0, 0],
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      borderColor: 'rgba(239, 68, 68, 0.9)',
      pointBackgroundColor: '#111827',
      pointBorderColor: '#ef4444',
      order: 1
    },
    {
      label: 'Aim',
      data: aimData || [0, 0, 0, 0],
      backgroundColor: 'rgba(59, 130, 246, 0.12)',
      borderColor: 'rgba(59, 130, 246, 0.9)',
      pointBackgroundColor: '#111827',
      pointBorderColor: '#3b82f6',
      order: 2
    }
  ];
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  // Configure marked for GFM and line breaks
  marked.setOptions({
    gfm: true,
    breaks: true
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
  } catch (err) {
    window.location.href = '/login';
    return;
  }

  try {
    initDashboard();
  } catch (err) {
    console.error('Error initializing dashboard:', err);
  }
}

// --- Initialize Dashboard after auth ---
function initDashboard() {
  // Set navbar role badge
  navbarRole.textContent = currentRole === 'manager' ? '⭐ Manager' : '👥 Team';
  navbarRole.className = `navbar-role role-${currentRole}`;

  // Hide manager-only UI elements for team login
  if (currentRole !== 'manager') {
    const updatePanel = document.getElementById('update-panel');
    if (updatePanel) updatePanel.classList.add('hidden');
    const navManager = document.getElementById('nav-manager');
    if (navManager) navManager.style.display = 'none';
  }

  // Setup logout
  btnLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  loadUsers();
  loadTeamAverages();

  // Only setup editing controls for manager
  // (Slider setup removed - moved to Manager View)
}

// --- Load Users ---
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();

    userSelect.innerHTML = '<option value="">— Choose a user —</option>';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.display_name + (u.role === 'manager' ? ' ⭐' : '');
      userSelect.appendChild(opt);
    });

    // Restore last selected user from localStorage
    const savedId = localStorage.getItem('selectedUserId');
    if (savedId) {
      userSelect.value = savedId;
      onUserSelected(savedId);
    }
  } catch (err) {
    showToast('Failed to load users', 'error');
  }

  userSelect.addEventListener('change', (e) => {
    const id = e.target.value;
    localStorage.setItem('selectedUserId', id);
    onUserSelected(id);
  });
}

// --- User Selected ---
async function onUserSelected(userId) {
  if (!userId) {
    currentUserId = null;
    emptyState.style.display = '';
    dashboardContent.style.display = 'none';
    return;
  }

  currentUserId = userId;
  emptyState.style.display = 'none';
  dashboardContent.style.display = '';

  await loadSkillData();
}

// --- Load Skill Data ---
async function loadSkillData() {
  if (!currentUserId) return;

  try {
    const [resSkills, resTodos] = await Promise.all([
      fetch(`/api/skills/${currentUserId}/latest`),
      fetch(`/api/todos?userId=${currentUserId}`)
    ]);
    latestData = await resSkills.json();
    userTodos = await resTodos.json();

    const d1Current = latestData.diamond1.current;
    const d1Aim = latestData.diamond1.aim;
    const d2Current = latestData.diamond2.current;
    const d2Aim = latestData.diamond2.aim;

    renderChart(1, d1Current, d1Aim);
    renderChart(2, d2Current, d2Aim);
    renderTodos();
  } catch (err) {
    showToast('Failed to load skill data', 'error');
  }
}

// --- Render Radar Chart ---
function renderChart(diamond, currentSnap, aimSnap) {
  const canvasId = diamond === 1 ? 'chart-diamond1' : 'chart-diamond2';
  const ctx = document.getElementById(canvasId).getContext('2d');

  const currentData = currentSnap
    ? [currentSnap.axis_1, currentSnap.axis_2, currentSnap.axis_3, currentSnap.axis_4]
    : [0, 0, 0, 0];

  const aimData = aimSnap
    ? [aimSnap.axis_1, aimSnap.axis_2, aimSnap.axis_3, aimSnap.axis_4]
    : [0, 0, 0, 0];

  const config = {
    type: 'radar',
    data: {
      labels: DIAMOND_LABELS[diamond],
      datasets: makeDatasets(currentData, aimData)
    },
    options: { ...CHART_OPTIONS }
  };

  if (diamond === 1) {
    if (chartD1) chartD1.destroy();
    chartD1 = new Chart(ctx, config);
  } else {
    if (chartD2) chartD2.destroy();
    chartD2 = new Chart(ctx, config);
  }
}

// --- Team Averages ---
async function loadTeamAverages() {
  try {
    const res = await fetch('/api/skills/averages');
    const data = await res.json();

    if (data.diamond1) {
      const d1Vals = [data.diamond1.axis_1, data.diamond1.axis_2, data.diamond1.axis_3, data.diamond1.axis_4];
      renderTeamChart(1, d1Vals);
    }
    if (data.diamond2) {
      const d2Vals = [data.diamond2.axis_1, data.diamond2.axis_2, data.diamond2.axis_3, data.diamond2.axis_4];
      renderTeamChart(2, d2Vals);
    }
  } catch (err) {
    console.error('Failed to load team averages:', err);
  }
}

function renderTeamChart(diamond, data) {
  const canvasId = diamond === 1 ? 'chart-team-d1' : 'chart-team-d2';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const config = {
    type: 'radar',
    data: {
      labels: DIAMOND_LABELS[diamond],
      datasets: [{
        label: 'Team Average',
        data: data,
        backgroundColor: 'rgba(139, 92, 246, 0.15)',
        borderColor: 'rgba(139, 92, 246, 0.9)',
        pointBackgroundColor: '#111827',
        pointBorderColor: '#8b5cf6',
        borderWidth: 2.5
      }]
    },
    options: { ...CHART_OPTIONS }
  };

  if (diamond === 1) {
    if (teamChartD1) teamChartD1.destroy();
    teamChartD1 = new Chart(ctx, config);
  } else {
    if (teamChartD2) teamChartD2.destroy();
    teamChartD2 = new Chart(ctx, config);
  }
}

// --- Sliders (Manager only) ---
function setupSliders() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
      const d = slider.dataset.diamond;
      const a = slider.dataset.axis;
      const val = slider.value;

      document.getElementById(`val-d${d}-axis${a}`).textContent = val;
      updateSliderFill(slider);
      updateChartLive(Number(d));
    });
  });
}

// (Slider logic removed - moved to Manager View)

// --- LMS and To-Dos ---
function renderTodos() {
  renderDiamondTodos(1, document.getElementById('d1-goals'), document.getElementById('d1-goals-list'));
  renderDiamondTodos(2, document.getElementById('d2-goals'), document.getElementById('d2-goals-list'));
}

function renderDiamondTodos(diamond, containerEl, listEl) {
  const dTodos = userTodos.filter(t => t.diamond === diamond);
  const emptyEl = document.getElementById(`d${diamond}-goals-empty`);

  if (dTodos.length === 0) {
    containerEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  containerEl.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';

  const byAxis = { 1: [], 2: [], 3: [], 4: [] };
  dTodos.forEach(t => byAxis[t.axis].push(t));

  let html = '';
  for (let axis = 1; axis <= 4; axis++) {
    if (byAxis[axis].length === 0) continue;

    // Flatten array labels
    let label = DIAMOND_LABELS[diamond][axis - 1];
    if (Array.isArray(label)) label = label.join(' ');
    const axisName = label;

    const axisTodos = byAxis[axis];
    const completedCount = axisTodos.filter(t => t.completion.completed).length;
    const totalCount = axisTodos.length;

    const isOpen = openAxes[`${diamond}-${axis}`];

    html += `
      <div class="axis-group" style="margin-bottom: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.2);">
        <div class="axis-header" onclick="toggleAxis(${diamond}, ${axis})" style="cursor: pointer; padding: 14px 16px; background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="dropdown-caret" id="caret-${diamond}-${axis}" style="display: inline-block; transition: transform 0.3s ease; color: var(--text-muted); font-size: 0.8rem; ${isOpen ? 'transform: rotate(90deg);' : ''}">▶</span>
            <strong style="color: var(--text-primary); font-size: 0.95rem;">${axisName}</strong>
          </div>
          <span style="font-size: 0.8rem; color: var(--text-secondary); background: var(--bg-secondary); padding: 4px 10px; border-radius: 12px; font-weight: 600;">${completedCount} / ${totalCount} Done</span>
        </div>
        <div class="axis-content" id="axis-content-${diamond}-${axis}" style="display: ${isOpen ? 'block' : 'none'}; border-top: 1px solid var(--border-subtle); background: var(--bg-secondary);">
    `;

    // Group by level
    const levels = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    axisTodos.forEach(t => {
      const lvl = t.level || 1;
      if (levels[lvl]) levels[lvl].push(t);
    });

    // Check locked state for each level
    let previousLevelIncomplete = false;
    for (let l = 1; l <= 5; l++) {
      if (levels[l].length === 0) continue;

      const levelTodos = levels[l];
      const isLevelComplete = levelTodos.every(t => t.completion.completed);
      const isLocked = previousLevelIncomplete;

      html += `
          <div class="level-group" style="margin: 8px; border-left: 2px solid ${isLocked ? 'var(--border-subtle)' : 'var(--accent-blue)'}; padding-left: 12px;">
            <h5 style="font-size: 0.85rem; color: ${isLocked ? 'var(--text-muted)' : 'var(--text-primary)'}; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
              Level ${l} ${isLocked ? '<span style="font-size: 0.75rem;">(Locked)</span>' : ''}
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
          const submittedDate = t.completion.submitted_at ? new Date(t.completion.submitted_at).toLocaleDateString() : '';
          extraText = `<span style="font-size: 0.75rem; color: var(--accent-blue); padding-left: 8px;">(Awaiting Approval${submittedDate ? ' · ' + submittedDate : ''})</span>`;
        } else if (isDone) {
          icon = '<span style="color: var(--accent-green); font-weight: bold;">✓</span>';
          textStyle = 'text-decoration: line-through; color: var(--text-muted);';
        }

        if (isLocked) {
          return `
            <div class="todo-item-row locked" style="padding: 8px 12px; display: flex; align-items: center; gap: 12px; opacity: 0.5; cursor: not-allowed; border-bottom: 1px solid rgba(255,255,255,0.02);">
              ${icon}
              <span style="color: var(--text-muted); font-size: 0.9rem; font-weight: 500;">${escapeHtml(t.title)}</span>
              ${extraText}
            </div>
          `;
        } else {
          return `
            <div class="todo-item-row" onclick="openLmsModal(${t.id})" style="cursor: pointer; padding: 8px 12px; display: flex; align-items: center; gap: 12px; transition: background 0.2s; border-bottom: 1px solid rgba(255,255,255,0.02);" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='transparent'">
              ${icon}
              <span style="color: var(--text-primary); font-size: 0.9rem; font-weight: 500; ${textStyle}">${escapeHtml(t.title)}</span>
              ${extraText}
            </div>
          `;
        }
      }).join('');

      html += `</div>`; // Close level-group

      if (!isLevelComplete) {
        previousLevelIncomplete = true;
      }
    }

    html += `
        </div>
      </div>
    `;
  }
  listEl.innerHTML = html;
}

window.toggleAxis = function (diamond, axis) {
  const el = document.getElementById(`axis-content-${diamond}-${axis}`);
  const caret = document.getElementById(`caret-${diamond}-${axis}`);

  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (caret) caret.style.transform = 'rotate(90deg)';
    openAxes[`${diamond}-${axis}`] = true;
  } else {
    el.style.display = 'none';
    if (caret) caret.style.transform = 'rotate(0deg)';
    openAxes[`${diamond}-${axis}`] = false;
  }
};

const lmsModal = document.getElementById('lms-modal');
const lmsTitle = document.getElementById('lms-title');
const lmsSubtitle = document.getElementById('lms-subtitle');
const lmsContent = document.getElementById('lms-content');
const lmsStatus = document.getElementById('lms-status');
const btnLmsComplete = document.getElementById('btn-lms-complete');
const btnLmsClose = document.getElementById('btn-lms-close');

const tabLmsInfo = document.getElementById('tab-lms-info');
const tabLmsNotes = document.getElementById('tab-lms-notes');
const paneLmsInfo = document.getElementById('lms-info-pane');
const paneLmsNotes = document.getElementById('lms-notes-pane');
const lmsNotesInput = document.getElementById('lms-notes-input');
const lmsNotesView = document.getElementById('lms-notes-view');
const btnSaveNotes = document.getElementById('btn-save-notes');
const btnEditNotes = document.getElementById('btn-edit-notes');
const btnCancelNotes = document.getElementById('btn-cancel-notes');

if (btnLmsClose) {
  btnLmsClose.addEventListener('click', () => lmsModal.classList.remove('visible'));
  lmsModal.addEventListener('click', (e) => {
    if (e.target === lmsModal) lmsModal.classList.remove('visible');
  });

  // Tab Switching
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
    paneLmsNotes.style.display = 'flex';
    paneLmsInfo.style.display = 'none';
  });

  // Edit Mode Toggle
  const startEditing = () => {
    lmsNotesView.style.display = 'none';
    lmsNotesInput.style.display = 'block';
    btnEditNotes.style.display = 'none';
    btnSaveNotes.style.display = 'inline-flex';
    btnCancelNotes.style.display = 'inline-flex';
    lmsNotesInput.focus();
  };

  btnEditNotes.addEventListener('click', startEditing);
  lmsNotesView.addEventListener('click', startEditing);

  btnCancelNotes.addEventListener('click', () => {
    lmsNotesInput.value = activeTodo.completion.notes || '';
    lmsNotesView.style.display = 'block';
    lmsNotesInput.style.display = 'none';
    btnEditNotes.style.display = 'inline-flex';
    btnSaveNotes.style.display = 'none';
    btnCancelNotes.style.display = 'none';
  });

  // Save Notes
  btnSaveNotes.addEventListener('click', async () => {
    if (!activeTodo || !currentUserId) return;
    const notes = lmsNotesInput.value;

    try {
      btnSaveNotes.disabled = true;
      const res = await fetch(`/api/todos/${activeTodo.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, notes })
      });
      if (!res.ok) throw new Error('Failed to save notes');

      activeTodo.completion.notes = notes;
      lmsNotesView.innerHTML = notes ? marked.parse(notes) : '<i style="color: var(--text-muted);">No notes yet. Click edit to add some!</i>';
      
      // Switch back to view mode
      lmsNotesView.style.display = 'block';
      lmsNotesInput.style.display = 'none';
      btnEditNotes.style.display = 'inline-flex';
      btnSaveNotes.style.display = 'none';
      btnCancelNotes.style.display = 'none';

      showToast('Notes saved successfully');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnSaveNotes.disabled = false;
    }
  });

  btnLmsComplete.addEventListener('click', async () => {
    if (!activeTodo || !currentUserId) return;

    // Managers should probably not check off tasks for the team from this interface, 
    // but the backend allows it. However, if they want to modify, they can.

    const status = activeTodo.completion.status || 'incomplete';
    // If it's awaiting approval or completed, the next click sets it to incomplete
    const isCurrentlyDoneOrAwaiting = status === 'completed' || status === 'awaiting_approval';
    const newState = !isCurrentlyDoneOrAwaiting;

    try {
      btnLmsComplete.disabled = true;
      const res = await fetch(`/api/todos/${activeTodo.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, completed: newState })
      });
      if (!res.ok) throw new Error('Failed to update status');

      const updatedStatus = await res.json();
      activeTodo.completion.completed = updatedStatus.completed;
      activeTodo.completion.status = updatedStatus.status;

      updateLmsButtonState();
      renderTodos();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnLmsComplete.disabled = false;
    }
  });
}

window.openLmsModal = function (todoId) {
  const t = userTodos.find(x => x.id === todoId);
  if (!t) return;
  activeTodo = t;

  let label = DIAMOND_LABELS[t.diamond][t.axis - 1];
  const axisName = (Array.isArray(label) ? label.join(' ') : label).replace('\n', ' ');
  lmsSubtitle.textContent = `Diamond ${t.diamond} · ${axisName}`;
  lmsTitle.textContent = t.title;

  // Parse Markdown to HTML
  lmsContent.innerHTML = marked.parse(t.content || '');

  // Populate Notes
  lmsNotesInput.value = t.completion.notes || '';
  lmsNotesView.innerHTML = (t.completion.notes) ? marked.parse(t.completion.notes) : '<i style="color: var(--text-muted);">No notes yet. Click edit to add some!</i>';

  // Reset to View Mode
  lmsNotesView.style.display = 'block';
  lmsNotesInput.style.display = 'none';
  btnEditNotes.style.display = 'inline-flex';
  btnSaveNotes.style.display = 'none';
  btnCancelNotes.style.display = 'none';

  // Reset Tab
  tabLmsInfo.click();

  updateLmsButtonState();
  lmsModal.classList.add('visible');
};

function updateLmsButtonState() {
  if (!activeTodo) return;
  const status = activeTodo.completion.status || (activeTodo.completion.completed ? 'completed' : 'incomplete');

  if (status === 'completed') {
    lmsStatus.textContent = 'Status: Completed ✓';
    lmsStatus.style.color = '#10b981';
    btnLmsComplete.textContent = 'Mark Incomplete';
    btnLmsComplete.className = 'btn btn-secondary';
  } else if (status === 'awaiting_approval') {
    const submittedDate = activeTodo.completion.submitted_at ? new Date(activeTodo.completion.submitted_at).toLocaleDateString() : '';
    lmsStatus.textContent = `Status: Awaiting Approval ⏳ ${submittedDate ? '(' + submittedDate + ')' : ''}`;
    lmsStatus.style.color = '#3b82f6';
    btnLmsComplete.textContent = 'Cancel Completion Request';
    btnLmsComplete.className = 'btn btn-secondary';
  } else {
    lmsStatus.textContent = 'Status: Incomplete';
    lmsStatus.style.color = 'var(--text-muted)';
    btnLmsComplete.textContent = 'Mark as Complete ✓';
    btnLmsComplete.className = 'btn btn-primary';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Toast ---
function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} visible`;
  setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 3000);
}
