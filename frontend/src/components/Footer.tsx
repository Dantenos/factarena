import { Link } from 'react-router-dom';

// Footer global : les liens Privacy Policy et Terms of Service doivent être
// accessibles depuis TOUTE l'application (contrainte éliminatoire du sujet).
export default function Footer() {
  return (
    <footer className="p-4 text-white text-sm flex gap-4">
      <span>© FactArena</span>
      <Link to="/privacy">Privacy Policy</Link>
      <Link to="/terms">Terms of Service</Link>
    </footer>
  );
}
