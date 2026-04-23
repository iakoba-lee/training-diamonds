/* ============================================================
   Skill Portal — Login Page Logic
   ============================================================ */

let selectedRole = 'team';

document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  fetch('/api/auth/me')
    .then(res => {
      if (res.ok) {
        window.location.href = '/';
      }
    })
    .catch(() => {});

  // Tab switching
  const tabs = document.querySelectorAll('.login-tab');
  const passwordLabel = document.getElementById('password-label');
  const passwordInput = document.getElementById('login-password');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedRole = tab.dataset.role;

      if (selectedRole === 'manager') {
        passwordLabel.textContent = 'Manager Password';
        passwordInput.placeholder = 'Enter manager password';
      } else {
        passwordLabel.textContent = 'Team Access Code';
        passwordInput.placeholder = 'Enter access code';
      }

      passwordInput.value = '';
      passwordInput.focus();
      document.getElementById('login-error').textContent = '';
    });
  });

  // Form submission
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value.trim();

    if (!password) {
      errorEl.textContent = 'Please enter the access code';
      return;
    }

    btnLogin.disabled = true;
    btnLogin.textContent = 'Signing in...';
    errorEl.textContent = '';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, password })
      });

      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.error || 'Login failed';
        return;
      }

      // Redirect based on role
      window.location.href = '/';
    } catch (err) {
      errorEl.textContent = 'Connection error. Please try again.';
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Sign In';
    }
  });
});
