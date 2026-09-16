export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}
