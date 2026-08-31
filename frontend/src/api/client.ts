// Client HTTP unique : un seul endroit qui sait ajouter le jeton et traiter
// les erreurs. URL relatives (/api/...) parce que le navigateur ne parle qu'à
// nginx — une URL en dur type http://backend:3000 ne marcherait que dans Docker.

const TOKEN_KEY = 'factarena.token';

/** Émis quand le back refuse le jeton : le contexte d'auth s'y abonne. */
export const SESSION_EXPIREE = 'factarena:session-expiree';

/** Erreur enrichie du code HTTP, pour que l'appelant puisse réagir au 401. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Appelle l'API. Ajoute le jeton s'il existe, et transforme une réponse
 * d'erreur en exception ApiError porteuse du message renvoyé par le back.
 *
 * Le back renvoie ses erreurs de validation sous la forme
 * { message: string | string[] } : on aplatit le tableau pour l'affichage.
 */
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
    // On tente de lire le message du back ; s'il n'y en a pas (502, coupure
    // réseau...), on reste sur un message générique plutôt que de planter ici.
    let message = `Erreur ${reponse.status}`;
    try {
      const donnees = await reponse.json();
      if (donnees?.message) {
        message = Array.isArray(donnees.message) ? donnees.message.join(', ') : donnees.message;
      }
    } catch {
      /* corps vide ou non JSON : on garde le message générique */
    }
    // Jeton expiré (il dure 1 h). L'effacer ne suffit pas : AuthContext garde
    // l'utilisateur en mémoire et la page reste affichée comme connectée, en
    // empilant des « Missing bearer token ». On le prévient.
    if (reponse.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIREE));
    }
    throw new ApiError(reponse.status, message);
  }

  // 204 No Content : pas de corps à parser (suppressions, par exemple).
  if (reponse.status === 204) return undefined as T;
  return (await reponse.json()) as T;
}

// --- Types partagés avec le back (voir backend/src/auth/auth.service.ts) ---

export interface Utilisateur {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  role: string;
}

export interface ReponseAuth {
  accessToken: string;
  user: Utilisateur;
}

/** ⚠️ Le back attend un EMAIL, pas un pseudo (cf. LoginDto / RegisterDto). */
export function connexion(email: string, motDePasse: string) {
  return api<ReponseAuth>('/auth/login', {
    method: 'POST',
    body: { email, password: motDePasse },
  });
}

export function inscription(email: string, motDePasse: string) {
  return api<ReponseAuth>('/auth/register', {
    method: 'POST',
    body: { email, password: motDePasse },
  });
}

export function profil() {
  return api<Utilisateur>('/users/me');
}

/** ⚠️ Le back renvoie `virtualBalance`, pas `balance` : se tromper de nom
 *  affichait un solde vide sans la moindre erreur, le champ étant simplement
 *  `undefined`. */
export function solde() {
  return api<{ virtualBalance: number }>('/ledger/balance');
}

export function listeSalons() {
  return api<unknown[]>('/rooms');
}

// --- Amis (module « User interaction » du sujet) ---

/** Un ami, tel que /friends/presence le renvoie. */
export interface Ami {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl: string | null;
  status: string;
  currentRoomId?: string | null;
}

/** On demande /presence plutôt que /friends : même liste, plus le salon en
 *  cours de chacun. Le sujet demande de voir la présence des amis. */
export function listeAmis() {
  return api<Ami[]>('/friends/presence');
}

export function ajouterAmi(friendId: string) {
  return api<unknown>('/friends', { method: 'POST', body: { friendId } });
}

export function retirerAmi(friendId: string) {
  return api<unknown>(`/friends/${friendId}`, { method: 'DELETE' });
}

/** Cherche des joueurs par e-mail ou pseudo. Le back exige deux caractères. */
export function chercherJoueurs(texte: string) {
  return api<Ami[]>(`/users?recherche=${encodeURIComponent(texte)}`);
}

// --- Profil ---

export function modifierProfil(champs: { displayName?: string }) {
  return api<Utilisateur>('/users/me', { method: 'PATCH', body: champs });
}

/** L'avatar part en multipart, pas en JSON : on court-circuite donc `api`,
 *  qui impose Content-Type application/json. Le navigateur doit poser lui-même
 *  la frontière multipart, on ne fixe surtout aucun en-tête de contenu. */
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
    } catch { /* corps vide */ }
    if (reponse.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIREE));
    }
    throw new ApiError(reponse.status, message);
  }
  return reponse.json() as Promise<Utilisateur>;
}
