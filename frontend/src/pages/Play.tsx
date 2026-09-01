// Lobby — liste des salons existants et création d'un salon.
//
// Avant, cette page affichait « room1, 2, 3... » en dur et le bouton pointait
// vers /room sans identifiant, donc vers une page qui ne pouvait rien charger.
// Elle interroge maintenant les vrais endpoints du back.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Salon {
  id: string;
  name: string;
  status: string;
}

export default function Play() {
  const navigate = useNavigate();
  const [salons, setSalons] = useState<Salon[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback(() => {
    setChargement(true);
    api<Salon[]>('/rooms')
      .then((liste) => { setSalons(liste); setErreur(null); })
      .catch((e) => setErreur(e instanceof Error ? e.message : 'Chargement impossible'))
      .finally(() => setChargement(false));
  }, []);

  useEffect(charger, [charger]);

  async function creerSalon() {
    setCreation(true);
    setErreur(null);
    try {
      // Nom horodaté : deux salons créés à la suite restent distinguables sans
      // demander une saisie à l'utilisateur.
      const salon = await api<Salon>('/rooms', {
        method: 'POST',
        body: { name: `Salon ${new Date().toLocaleTimeString('fr-FR')}` },
      });
      navigate(`/room/${salon.id}`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Création impossible');
    } finally {
      setCreation(false);
    }
  }

  return (
    <section className="grid gap-4 grid-cols-1 lg:grid-cols-2 p-4 sm:p-8 bg-noir-krystal w-full min-h-full">
      <div className="lg:col-span-1 lg:col-start-1">
        <h1 className="bg-grisclair-krystal text-[20px] px-8 py-2 w-full lg:w-[46%] text-white font-semibold rounded-xl">
          Rejoindre une room
        </h1>

        <div className="p-4 sm:p-8 gap-2 bg-gris-krystal min-h-[92%] rounded-xl flex flex-col gap-3">
          {chargement && <p className="text-white">Chargement des salons...</p>}

          {!chargement && salons.length === 0 && (
            <p className="text-gray-300">Aucun salon pour le moment. Crée le premier.</p>
          )}

          {salons.map((salon) => (
            <button
              key={salon.id}
              type="button"
              onClick={() => navigate(`/room/${salon.id}`)}
              className="bg-noir-krystal rounded-xl text-white px-4 py-3 text-left hover:bg-grisclair-krystal transition-colors"
            >
              <span className="font-semibold">{salon.name}</span>
              <span className="text-sm text-gray-400 ml-3">{salon.status}</span>
            </button>
          ))}

          {/* role="alert" : l'erreur est annoncée aux lecteurs d'écran. */}
          {erreur && <p role="alert" className="text-red-l text-sm">{erreur}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-4 justify-center lg:col-start-2 p-4 sm:p-8">
        <button
          type="button"
          onClick={creerSalon}
          disabled={creation}
          className="flex items-center justify-center px-6 sm:px-10 py-6 sm:py-10 button-blue-d text-xl disabled:opacity-50"
        >
          {creation ? 'Création...' : 'Créer une room'}
        </button>

        <button
          type="button"
          onClick={charger}
          className="px-6 py-2 button-blue-l"
        >
          Rafraîchir la liste
        </button>
      </div>
    </section>
  );
}
