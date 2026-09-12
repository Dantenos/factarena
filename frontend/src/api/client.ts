const TOKEN_KEY = 'factarena.token';

export const SESSION_EXPIREE = 'factarena:session-expiree';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function tokenExpire(token: string): boolean {
  const parties = token.split('.');
  if (parties.length !== 3) return true;
  try {
    const base64Payload = parties[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64Payload.padEnd(Math.ceil(base64Payload.length / 4) * 4, '=')));
    return typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T = unknown>(
  chemin: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = getToken();
  const reponse = await fetch(`/api${chemin}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!reponse.ok) {
    let message = `Erreur ${reponse.status}`;
    try {
      const donnees = await reponse.json();
      if (donnees?.message) {
        message = Array.isArray(donnees.message) ? donnees.message.join(', ') : donnees.message;
      }
    } catch {
    }
    if (reponse.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIREE));
    }
    throw new ApiError(reponse.status, message);
  }

  if (reponse.status === 204) return undefined as T;
  return (await reponse.json()) as T;
}

export interface Utilisateur {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  role: string;
  experience: number;
  level: number;
}

export interface ReponseAuth {
  accessToken: string;
  user: Utilisateur;
}

export interface ReponseLoginEchec {
  loginFailed: true;
  message: string;
}

export interface ReponseInscriptionDejaExistante {
  alreadyExists: true;
  message: string;
}

export interface ReponseInscriptionPseudoDejaUtilise {
  pseudoAlreadyExists: true;
  message: string;
}

export function connexion(email: string, motDePasse: string) {
  return api<ReponseAuth | ReponseLoginEchec>('/auth/login', {
    method: 'POST',
    body: { email, password: motDePasse },
  });
}

export function inscription(email: string, motDePasse: string, pseudo: string) {
  return api<ReponseAuth | ReponseInscriptionDejaExistante | ReponseInscriptionPseudoDejaUtilise>('/auth/register', {
    method: 'POST',
    body: { email, password: motDePasse, displayName: pseudo },
  });
}

export function profil() {
  return api<Utilisateur | null>('/users/me');
}

export function reclamerRattrapage() {
  return api<{ virtualBalance: number; credite: number }>('/ledger/rattrapage', { method: 'POST' });
}

export function solde() {
  return api<{ virtualBalance: number }>('/ledger/balance');
}

export function listeSalons() {
  return api<unknown[]>('/rooms');
}

export interface Ami {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl: string | null;
  status: string;
  currentRoomId?: string | null;
}

export interface DemandesAmis {
  received: (Ami & { id: string })[];
  sent: (Ami & { id: string })[];
}

export function listeAmis() {
  return api<Ami[]>('/friends/presence');
}

export function demandesAmis() {
  return api<DemandesAmis>('/friends/requests');
}

export function ajouterAmi(friendId: string) {
  return api<Ami & { alreadyFriends?: boolean; requestPending?: boolean }>('/friends', {
    method: 'POST',
    body: { friendId },
  });
}

export function accepterDemande(requestId: string) {
  return api<unknown>(`/friends/requests/${requestId}/accept`, { method: 'POST' });
}

export function refuserDemande(requestId: string) {
  return api<unknown>(`/friends/requests/${requestId}`, { method: 'DELETE' });
}

export function retirerAmi(friendId: string) {
  return api<unknown>(`/friends/${friendId}`, { method: 'DELETE' });
}

export function chercherJoueurs(texte: string) {
  return api<Ami[]>(`/users?recherche=${encodeURIComponent(texte)}`);
}

export function modifierProfil(champs: { displayName?: string }) {
  return api<Utilisateur>('/users/me', { method: 'PATCH', body: champs });
}

export async function envoyerAvatar(fichier: File): Promise<Utilisateur> {
  const corps = new FormData();
  corps.append('avatar', fichier);
  const reponse = await fetch('/api/users/me/avatar', {
    method: 'POST',
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: corps,
  });
  if (!reponse.ok) {
    let message = `Erreur ${reponse.status}`;
    try {
      const d = await reponse.json();
      if (d?.message) message = Array.isArray(d.message) ? d.message.join(', ') : d.message;
    } catch {
    }
    if (reponse.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIREE));
    }
    throw new ApiError(reponse.status, message);
  }
  return reponse.json() as Promise<Utilisateur>;
}
