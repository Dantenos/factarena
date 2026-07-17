import { useEffect, useState } from 'react';

// Page d'accueil. Elle appelle /api/health (le backend, via nginx, même origine)
// pour vérifier que la chaîne front -> nginx -> back fonctionne. L'erreur est
// gérée proprement (aucune exception non catchée -> aucune erreur console).
export default function Home() {
  const [apiStatus, setApiStatus] = useState<string>('...');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { status: string }) => setApiStatus(data.status))
      .catch(() => setApiStatus('indisponible'));
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-bold">FactArena</h1>
      <p className="mt-2">
        État de l'API backend : <strong>{apiStatus}</strong>
      </p>
    </section>
  );
}
