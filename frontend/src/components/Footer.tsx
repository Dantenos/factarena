import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="p-4 text-white text-sm flex flex-wrap gap-x-4 gap-y-1">
      <span>© FactArena</span>
      <Link to="/privacy">Privacy Policy</Link>
      <Link to="/terms">Terms of Service</Link>
    </footer>
  );
}
