// Page Privacy Policy — contenu RÉEL (contrainte éliminatoire du sujet : une
// page vide ou générique fait rejeter le projet).
//
// Deux points méritent d'être signalés parce qu'ils sont souvent oubliés :
// 1. on déclare explicitement l'envoi des messages de chat à Mistral (notre
//    prestataire IA) — c'est un transfert de données à un tiers, le taire
//    serait malhonnête et juridiquement fautif ;
// 2. on annonce que les crédits sont virtuels, ce qui écarte d'emblée toute
//    lecture « jeu d'argent » (voir aussi les CGU).
export default function Privacy() {
  return (
    <section className="bg-noir-krystal w-full min-h-full text-white px-6 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Politique de confidentialité</h1>
          <p className="text-sm text-gray-400">
            Dernière mise à jour : août 2026 — FactArena est un projet étudiant
            réalisé dans le cadre du cursus de l'école 42.
          </p>
        </header>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">1. Qui sommes-nous ?</h2>
          <p>
            FactArena est une plateforme de jeu pédagogique consacrée à la
            vérification de l'information. Elle est développée par une équipe
            d'étudiants de l'école 42 à des fins d'apprentissage. Elle n'a
            aucune finalité commerciale et vos données ne sont ni vendues, ni
            cédées, ni utilisées à des fins publicitaires.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">2. Données que nous collectons</h2>
          <ul className="list-disc pl-6 flex flex-col gap-2">
            <li>
              <strong>Compte</strong> : votre adresse e-mail et votre mot de passe.
              Le mot de passe n'est <strong>jamais</strong> conservé en clair : il est
              haché et salé (bcrypt) avant d'être enregistré.
            </li>
            <li>
              <strong>Profil</strong> : votre pseudonyme et, si vous en ajoutez un,
              votre avatar.
            </li>
            <li>
              <strong>Connexion via 42</strong> : si vous choisissez ce mode
              d'authentification, nous recevons votre identifiant et votre e-mail
              depuis l'intranet de l'école.
            </li>
            <li>
              <strong>Activité de jeu</strong> : parties jouées, votes émis sur
              chaque extrait, mises en crédits virtuels, scores et classement.
            </li>
            <li>
              <strong>Messages de salon</strong> : le contenu que vous écrivez dans
              le chat, ainsi que les questions posées à l'assistant.
            </li>
            <li>
              <strong>Données techniques</strong> : journaux de connexion et
              d'erreurs, conservés pour le bon fonctionnement du service.
            </li>
          </ul>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">3. Pourquoi ces données</h2>
          <p>
            Elles servent exclusivement à vous authentifier, à faire fonctionner
            les parties en temps réel, à tenir le classement et l'historique, à
            modérer le chat, et à assurer la sécurité du service.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">
            4. Recours à un prestataire d'intelligence artificielle
          </h2>
          <p>
            Deux fonctionnalités reposent sur un service d'IA externe,{' '}
            <strong>Mistral AI</strong> (société française, données traitées dans
            l'Union européenne) :
          </p>
          <ul className="list-disc pl-6 flex flex-col gap-2">
            <li>
              <strong>la modération du chat</strong> : chaque message publié est
              transmis à ce prestataire pour détecter les contenus haineux,
              violents ou sexuels ;
            </li>
            <li>
              <strong>l'assistant de vérification</strong> : les questions que vous
              lui adressez lui sont transmises pour produire une réponse sourcée.
            </li>
          </ul>
          <p>
            Concrètement, <strong>le texte de vos messages de chat et de vos
            questions quitte nos serveurs</strong>. N'y écrivez aucune information
            personnelle ou sensible. Aucune autre donnée (e-mail, mot de passe,
            historique de jeu) n'est transmise à ce prestataire.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">5. Conservation</h2>
          <p>
            Vos données sont conservées tant que votre compte existe. À sa
            suppression, votre compte, votre profil et vos messages sont effacés.
            Les résultats de parties peuvent être conservés sous forme anonyme
            pour préserver la cohérence des classements.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">6. Vos droits</h2>
          <p>
            Conformément au RGPD, vous pouvez accéder à vos données, les
            rectifier, les supprimer, ou demander leur portabilité. La page de
            profil permet de modifier vos informations et de supprimer votre
            compte. Pour toute autre demande, contactez l'équipe via le dépôt du
            projet.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">7. Sécurité et traceurs</h2>
          <p>
            Tous les échanges avec le site sont chiffrés (HTTPS et WSS). Les mots
            de passe sont hachés et salés. Nous n'utilisons{' '}
            <strong>aucun cookie publicitaire ni traceur tiers</strong> : seul un
            jeton de session est conservé par votre navigateur pour vous garder
            connecté.
          </p>
        </article>

        <article className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-bleu-l">8. Sources affichées</h2>
          <p>
            Les verdicts présentés dans le jeu proviennent d'organismes de
            vérification indépendants (AFP Factuel, franceinfo, Reuters…) et les
            données chiffrées de sources publiques officielles (INSEE, Eurostat,
            Banque mondiale). Chaque verdict est accompagné de son lien d'origine.
          </p>
        </article>
      </div>
    </section>
  );
}
