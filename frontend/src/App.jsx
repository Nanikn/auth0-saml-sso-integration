import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import LoggedOutPage from './pages/LoggedOutPage.jsx';

export default function App() {
  return (
    <div className="shell">
      <header className="top">
        <p className="product">Platform</p>
        <p className="product-note">SAML SSO demo — Auth0 is the identity provider</p>
      </header>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/logged-out/:via" element={<LoggedOutPage />} />
      </Routes>
    </div>
  );
}
