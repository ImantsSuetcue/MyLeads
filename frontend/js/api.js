// Small fetch wrapper shared by every page: adds the JWT auth header automatically
// and throws a plain Error with the backend's message on non-2xx responses.
const API_BASE = 'http://localhost:3000/api';
const TOKEN_KEY = 'myleads_token';

const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
  isLoggedIn: () => Boolean(localStorage.getItem(TOKEN_KEY)),
};

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Anfrage fehlgeschlagen (${res.status})`);
  }
  return data;
}
