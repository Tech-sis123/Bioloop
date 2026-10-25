import { Link } from 'react-router-dom';
import { LogoMark } from '../ui/Icon.jsx';
import Icon from '../ui/Icon.jsx';
import '../landing.css';

// Plain-language privacy policy. Reflects what the app actually stores.
// Have it reviewed before a large public launch.
export default function Privacy() {
  return (
    <div className="land">
      <header className="land-nav solid">
        <Link to="/welcome" className="logo" aria-label="BioLoop home">
          <LogoMark size={32} a="#7CE3A3" b="#A9BBFF" />
          <span>BioLoop</span>
        </Link>
        <Link to="/welcome" className="auth-back"><Icon name="back" size={18} />Back</Link>
      </header>
      <main className="land-wrap privacy">
        <h1>Privacy policy</h1>
        <p className="muted">Last updated 25 October 2026</p>

        <p>BioLoop runs smart waste bins and the app that goes with them. This page explains what we collect, why, and what you can do about it. We follow the Nigeria Data Protection Act 2023.</p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Your account:</strong> name, email, phone number (optional) and a securely hashed password. We never see or store your actual password.</li>
          <li><strong>Your bin:</strong> the station you chose as your bin.</li>
          <li><strong>What you do in the app:</strong> drops you log, Loop points, problem reports you send, and which alerts you have read.</li>
          <li><strong>Collectors and recyclers:</strong> pickups you start or complete, weights you log, and batches you reserve.</li>
          <li><strong>Security records:</strong> sign-in times and IP addresses, kept to protect accounts from misuse.</li>
          <li><strong>Bin sensors:</strong> fill levels, battery and signal readings from the bins. These are about bins, not people.</li>
        </ul>

        <h2>What we do not collect</h2>
        <ul>
          <li>Your location. "Find a bin" can use your location to sort nearby stations, but that happens on your phone and is never sent to us.</li>
          <li>Payment details, contacts or photos.</li>
          <li>Advertising or tracking cookies. The only cookie we set keeps you signed in.</li>
        </ul>

        <h2>Why we use it</h2>
        <ul>
          <li>To run your account and show you your bin, alerts and points.</li>
          <li>To tell collectors which bins need emptying and to tell you when they are coming.</li>
          <li>To give waste agencies totals and reports. These use bin and pickup data, not your personal details.</li>
          <li>To keep the service secure.</li>
        </ul>
        <p>We do not sell your data or share it for advertising.</p>

        <h2>Who else handles it</h2>
        <p>Our servers and database run on Render, and the web app on Vercel. If email is switched on, password reset emails are sent through Resend. These providers only process data so the service can run.</p>
        <p>Collectors can see station names and fill levels, not who lives near them. Agency staff can see account names and emails so they can manage access and help with problems.</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Your account, until you ask us to delete it.</li>
          <li>Alerts, for 120 days.</li>
          <li>Bin sensor readings, for 180 days.</li>
        </ul>

        <h2>Your rights</h2>
        <p>You can ask to see the data we hold about you, correct it, or have your account deleted. You can update your name and phone yourself in Profile. For anything else, email <a href="mailto:bioloopteam@gmail.com">bioloopteam@gmail.com</a> and we will reply within 30 days.</p>

        <h2>Changes</h2>
        <p>If we change this policy in a way that matters, we will update the date at the top and let you know in the app.</p>
      </main>
      <footer className="land-wrap land-foot">
        <span>© {new Date().getFullYear()} BioLoop. All rights reserved.</span>
        <a href="mailto:bioloopteam@gmail.com">bioloopteam@gmail.com</a>
      </footer>
    </div>
  );
}
