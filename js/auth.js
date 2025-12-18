// Authentication management
import { state } from './state.js';
import { query } from './api.js';

// DOM element references (set by main.js)
let elements = {};

export function setElements(els) {
  elements = els;
}

export async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  state.credentials = { user: username, password };

  try {
    // Test connection
    await query('SELECT 1');
    localStorage.setItem('clickhouse_credentials', JSON.stringify(state.credentials));
    elements.loginError.classList.remove('visible');
    // Dispatch event for dashboard to sync UI and load data
    window.dispatchEvent(new CustomEvent('login-success'));
  } catch (err) {
    state.credentials = null;
    elements.loginError.textContent = 'Authentication failed. Please check your credentials.';
    elements.loginError.classList.add('visible');
  }
}

export function handleLogout() {
  state.credentials = null;
  localStorage.removeItem('clickhouse_credentials');
  showLogin();
}

export function handleAuthError() {
  state.credentials = null;
  localStorage.removeItem('clickhouse_credentials');
  elements.loginError.textContent = 'Session expired. Please sign in again.';
  elements.loginError.classList.add('visible');
  showLogin();
}

export function showLogin() {
  elements.loginSection.classList.remove('hidden');
  elements.dashboardSection.classList.remove('visible');
}

export function showDashboard() {
  elements.loginSection.classList.add('hidden');
  elements.dashboardSection.classList.add('visible');
  // Dispatch event for autocomplete loading
  window.dispatchEvent(new CustomEvent('dashboard-shown'));
}

// Listen for auth errors from api.js
window.addEventListener('auth-error', handleAuthError);
