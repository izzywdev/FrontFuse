import axios from 'axios'
import { App, User } from '../lib/shared'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3003'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token to requests
api.interceptors.request.use(config => {
  const token = localStorage.getItem('authToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 responses (unauthorized)
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // Token is invalid or expired
      localStorage.removeItem('authToken')
      // Reload the page to trigger re-authentication
      window.location.reload()
    }
    return Promise.reject(error)
  }
)

export const login = async (email: string, password: string) => {
  const response = await api.post('/api/auth/login', { email, password })
  const { token, user } = response.data
  localStorage.setItem('authToken', token)
  return { token, user }
}

export const logout = async () => {
  try {
    await api.post('/api/auth/logout')
  } catch (error) {
    // Even if logout fails on server, remove local token
    console.error('Logout error:', error)
  } finally {
    localStorage.removeItem('authToken')
  }
}

export const getCurrentUser = async (): Promise<User> => {
  const response = await api.get('/api/auth/user')
  return response.data.user
}

export const fetchApps = async (): Promise<App[]> => {
  const response = await api.get('/api/apps')
  return response.data
}

export const fetchHealthyApps = async (): Promise<App[]> => {
  const response = await api.get('/api/apps?healthyOnly=true')
  return response.data
}

export const checkAppsHealth = async () => {
  const response = await api.get('/api/apps/health')
  return response.data
}

export const createApp = async (appData: Partial<App>): Promise<App> => {
  const response = await api.post('/api/apps', appData)
  return response.data
}

export const updateAppStatus = async (appId: string, isActive: boolean) => {
  const response = await api.put(`/api/apps/${appId}/activate`, { isActive })
  return response.data
}

export const deleteApp = async (appId: string) => {
  const response = await api.delete(`/api/apps/${appId}`)
  return response.data
}
