// Client HTTP unique de l'application.
//
// POURQUOI centraliser : sans ce fichier, chaque composant referait son propre
// fetch, oublierait la moitié du temps d'ajouter le jeton, et traiterait les
// erreurs différemment. Ici on a un seul endroit qui sait parler au back.
//
// POURQUOI des URL RELATIVES (/api/...) et pas une URL complète : le navigateur
// ne parle QU'À nginx, qui proxifie /api vers NestJS. Une URL en dur du type
// http://backend:3000 ne marcherait que dans Docker et casserait dans le
// navigateur. En relatif, ça fonctionne partout sans configuration.

const TOKEN_KEY = 'factarena.token';

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
    // Le jeton dure 1 h. Passé ce délai le back répond 401 : on nettoie, sinon
    // l'application continuerait d'envoyer un jeton mort à chaque requête.
    if (reponse.status === 401) clearToken();
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

export function solde() {
  return api<{ balance: number }>('/ledger/balance');
}

export function listeSalons() {
  return api<unknown[]>('/rooms');
}
