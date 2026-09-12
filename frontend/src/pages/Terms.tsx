import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <section className="bg-noir-krystal w-full min-h-full text-white px-6 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Conditions générales d'utilisation</h1>
          <p className="text-sm text-gray-400">
            Dernière mise à jour : août 2026. En utilisant FactArena, vous
            acceptez les conditions ci-dessous.
          </p>
        </header>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">1. Objet du service</h2>
          <p>
            FactArena est un jeu multijoueur en ligne consacré à la vérification
            de l'information. Une partie diffuse une série d'extraits vidéo
            devenus viraux ; chaque joueur juge si l'extrait relaie une
            information fiable ou une intox. Les verdicts sont ensuite révélés,
            accompagnés de leurs sources.
          </p>
          <p>
            Le service est un <strong>projet pédagogique</strong> réalisé par des
            étudiants de l'école 42. Il est fourni en l'état, sans garantie de
            disponibilité ni de continuité.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">2. Compte</h2>
          <p>
            La création d'un compte nécessite une adresse e-mail valide et un mot
            de passe, ou une connexion via l'intranet de l'école 42. Vous êtes
            responsable de la confidentialité de vos identifiants et des actions
            effectuées depuis votre compte. Un compte est strictement personnel.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">3. Règles du jeu</h2>
          <ul className="list-disc pl-6 flex flex-col gap-2">
            <li>
              Chaque partie enchaîne plusieurs extraits. Pour chacun, vous
              disposez d'une fenêtre de vote limitée, identique pour tous les
              joueurs et pilotée par le serveur.
            </li>
            <li>
              Vous engagez une mise en crédits virtuels au début de la partie.
            </li>
            <li>
              Le gagnant est celui qui a correctement jugé le plus d'extraits ; il
              remporte le pot commun, partagé en cas d'égalité.
            </li>
            <li>
              Le verdict de chaque extrait provient d'un organisme de vérification
              identifié, établi <strong>avant</strong> la partie. L'intelligence
              artificielle sert uniquement à <strong>expliquer</strong> ce verdict :
              elle ne décide jamais du résultat ni du gagnant.
            </li>
          </ul>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">
            4. Crédits virtuels : absence de valeur monétaire
          </h2>
          <p>
            Les crédits utilisés dans FactArena sont <strong>entièrement fictifs</strong>.
            Ils ne peuvent être ni achetés, ni vendus, ni échangés, ni convertis en
            argent ou en quelque contrepartie que ce soit. Ils n'ont{' '}
            <strong>aucune valeur monétaire</strong> et ne constituent pas un moyen
            de paiement.
          </p>
          <p>
            FactArena n'est donc <strong>pas un service de jeu d'argent ni de pari</strong>.
            Aucun paiement n'est demandé et aucun gain réel n'est distribué.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">5. Comportement dans le chat</h2>
          <p>
            Le chat des salons est destiné aux échanges liés à la partie. Sont
            interdits : les propos haineux ou discriminatoires, les menaces, les
            contenus sexuels, le harcèlement, la diffusion de données
            personnelles et le spam.
          </p>
          <p>
            Les messages sont soumis à une <strong>modération automatique par
            intelligence artificielle</strong>, susceptible de masquer un message ou
            d'émettre un avertissement. Un manquement répété peut entraîner la
            suspension du compte.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">6. Contenus de tiers</h2>
          <p>
            Les extraits vidéo présentés restent hébergés par leurs plateformes
            d'origine et demeurent la propriété de leurs auteurs : FactArena
            n'héberge aucune vidéo. Les verdicts de vérification appartiennent
            aux organismes qui les publient et sont systématiquement cités.
            FactArena ne porte aucun jugement propre sur les propos d'une
            personne nommée : seul le verdict d'un vérificateur identifié est
            rapporté.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">7. Limites de l'assistant IA</h2>
          <p>
            L'assistant fournit des réponses appuyées sur un corpus documentaire
            et cite ses sources. Il peut néanmoins se tromper ou être incomplet.
            Ses réponses sont indicatives et ne constituent ni un conseil, ni une
            vérité établie : reportez-vous toujours aux sources citées.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">8. Suspension et clôture</h2>
          <p>
            Vous pouvez supprimer votre compte à tout moment depuis votre profil.
            Nous pouvons suspendre un compte en cas de manquement à ces
            conditions, notamment en cas de tricherie, d'usage abusif du service
            ou de comportement nuisible envers les autres joueurs.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">9. Données personnelles</h2>
          <p>
            Le traitement de vos données est décrit dans notre{' '}
            <Link to="/privacy" className="text-bleu-l underline">
              politique de confidentialité
            </Link>
            , qui fait partie intégrante des présentes conditions.
          </p>
        </article>
      </div>
    </section>
  );
}
