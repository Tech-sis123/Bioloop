import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon, { LogoMark } from '../ui/Icon.jsx';
import Scene3D from '../three/Scene3D.jsx';
import '../landing.css';

// Free photos (Unsplash License). Each sits on a colour block so the layout
// holds while a photo loads.
const u = (id, w = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=72`;
const PHOTO = {
  resident: 'photo-1680879275304-bbe20f7e28fb',
  collector: 'photo-1636063448667-a42a681a7847',
  recycler: 'photo-1611284446314-60a58ac0deb9',
  agency: 'photo-1572816225927-d08fb138f2b2',
};

function Img({ id, w, alt }) {
  return <img src={u(id, w)} alt={alt} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
}

const binFallback = <div className="lp-fallback"><img src="/img/bioloop-bin.png" alt="The BioLoop smart bin" /></div>;

export default function Landing() {
  const [live, setLive] = useState({ organic: 78, locked: false });

  return (
    <div className="land">
      <header className="land-nav">
        <Link to="/welcome" className="logo" aria-label="BioLoop">
          <LogoMark size={32} a="#7CE3A3" b="#A9BBFF" />
          <span>BioLoop</span>
        </Link>
        <nav className="links" aria-label="Site">
          <a className="plain" href="#how">How it works</a>
          <a className="plain" href="#who">Who it's for</a>
          <Link to="/login" className="lp-btn light sm">Sign in</Link>
          <Link to="/register" className="lp-btn primary sm">Get started</Link>
        </nav>
      </header>

      <main>
        {/* Hero: live 3D bin */}
        <section className="lp-hero">
          <div className="land-wrap">
            <div className="lp-hero-grid">
              <div>
                <h1 className="lp-h">Bins that speak up before they spill.</h1>
                <p className="lp-p">
                  BioLoop is a solar-powered smart bin for Lagos. It sorts waste three ways, knows how full it is,
                  locks before it overflows and calls the collector itself. You just sort, drop and earn points.
                </p>
                <div className="cta">
                  <Link to="/register" className="lp-btn primary">Join as a resident</Link>
                  <Link to="/login" className="lp-btn light">Sign in</Link>
                </div>
                <span className="lp-hint"><Icon name="nav" size={14} />Drag the bin to look around it</span>
              </div>

              <div className="lp-stage">
                <Scene3D className="lp-canvas" mode="hero" onTick={setLive} fallback={binFallback} label="Interactive 3D model of the BioLoop smart bin" />
                <div className="glass g1" aria-hidden="true">
                  <div className="k">Organic compartment</div>
                  <div className="v">{live.organic}%<span className={`tag ${live.locked ? 'hot' : ''}`}>{live.locked ? 'Locked' : 'Filling'}</span></div>
                  <div className="meter"><i className={live.locked ? 'hot' : ''} style={{ width: `${live.organic}%` }} /></div>
                </div>
                <div className="glass g2" aria-hidden="true">
                  <span className="ic"><Icon name="truck" size={20} /></span>
                  <div><div className="k">Pickup requested</div><div style={{ fontWeight: 700, marginTop: 2 }}>CleanRoute NG, 2:30 PM</div></div>
                </div>
                <div className="glass g3" aria-hidden="true">+10 Loop points for sorting</div>
              </div>
            </div>

            <div className="lp-metrics">
              <div className="lp-metric"><b>32M+</b><span>tonnes of waste Nigeria generates every year</span></div>
              <div className="lp-metric"><b>&lt;40%</b><span>of it gets properly collected</span></div>
              <div className="lp-metric"><b>3</b><span>streams sorted right at the bin</span></div>
            </div>
          </div>
        </section>

        {/* The problem, in our own backyard */}
        <section className="land-wrap lp-sec lp-problem">
          <figure className="lp-photo" style={{ margin: 0 }}>
            <img src="/img/jaja-overflow.jpg" alt="Waste spilling around public bins at Jaja Complex, University of Lagos" loading="lazy" />
            <figcaption className="cap">Jaja Complex, University of Lagos.</figcaption>
          </figure>
          <div>
            <h2 className="lp-h">The bin was full on Monday. The truck came on Friday.</h2>
            <p className="lp-p">Nobody can see which bins are full, so collection runs on guesswork and fixed routes. By the time anyone notices, the waste is already on the ground.</p>
            <ul>
              <li><b>Overflow</b>Bins fill up days before pickup, and people start dumping beside them.</li>
              <li><b>Health</b>Flies, smell and pests follow, and spilled waste blocks the drains that stop flooding.</li>
              <li><b>Lost value</b>Bottles, cans and food waste get mixed, so recyclers and composters can't use them.</li>
            </ul>
            <p className="xs muted" style={{ marginTop: 16 }}>National waste figures as reported by Punch Newspapers.</p>
          </div>
        </section>

        {/* How it works, with a sensor cutaway in 3D */}
        <section id="how" className="lp-how lp-sec">
          <div className="land-wrap lp-how-grid">
            <div className="stage">
              <Scene3D className="lp-canvas" mode="sensor" fallback={binFallback} label="3D cutaway of the BioLoop bin showing sensor beams measuring each compartment" />
            </div>
            <div>
              <h2 className="lp-h">Every compartment has its own eyes.</h2>
              <p className="lp-p">An ultrasonic sensor above each compartment reads the waste level every few minutes, powered by the panel on the lid.</p>
              <ol className="lp-steps">
                <li><div><h3>You sort at the bin</h3><p>Wrappers and nylon in yellow, bottles and cans in blue, food and peels in green. The app shows which side has room.</p></div></li>
                <li><div><h3>The bin measures itself</h3><p>At 75% full it asks for a pickup. At 90% the lid locks, so nothing ends up on the ground.</p></div></li>
                <li><div><h3>The right truck comes</h3><p>Collectors get a route sorted by urgency, and clean recyclables go to local recyclers instead of the dumpsite.</p></div></li>
              </ol>
            </div>
          </div>
        </section>

        {/* Who it is for */}
        <section id="who" className="land-wrap lp-sec">
          <div className="lp-roles-head">
            <h2 className="lp-h">Built for everyone in the loop.</h2>
            <p className="lp-p" style={{ maxWidth: '40ch' }}>One system, four apps. Each person sees exactly what they need and nothing they don't.</p>
          </div>
          <div className="lp-roles">
            <article className="lp-role">
              <Img id={PHOTO.resident} w={700} alt="Young woman checking her phone" />
              <div className="body"><h3>Residents</h3><p>Live fill levels for your bin, alerts before it locks, and Loop points for every sorted drop.</p></div>
            </article>
            <article className="lp-role">
              <Img id={PHOTO.collector} w={700} alt="A van driving down a Lagos street" />
              <div className="body"><h3>Collectors</h3><p>Today's route sorted by locked bins first. Tell residents when you are coming and log what you picked up.</p></div>
            </article>
            <article className="lp-role">
              <Img id={PHOTO.recycler} w={700} alt="Red, yellow and green recycling bins" />
              <div className="body"><h3>Recyclers</h3><p>Clean, sorted PET, cans, paper and organics listed by weight and area. Reserve a batch in one tap.</p></div>
            </article>
            <article className="lp-role">
              <Img id={PHOTO.agency} w={700} alt="A busy street in Lagos" />
              <div className="body"><h3>Waste agencies</h3><p>A live map of every station, what needs pickup, who is assigned and how much moved this week.</p></div>
            </article>
          </div>
        </section>

        {/* Closing */}
        <section className="land-wrap" style={{ paddingBottom: 40 }}>
          <div className="lp-cta">
            <div className="copy">
              <h2 className="lp-h">Close the loop on your street.</h2>
              <p className="lp-p">Find the BioLoop bin near you, add its code and we will keep you posted every time it fills up.</p>
              <div className="cta">
                <Link to="/register" className="lp-btn primary">Create my account</Link>
                <Link to="/login" className="lp-btn light">I already have one</Link>
              </div>
            </div>
            <div className="loop">
              <Scene3D kind="loop" className="lp-canvas" fallback={null} label="Bottles, cans and leaves circling a loop" />
            </div>
          </div>
        </section>
      </main>

      <footer className="land-wrap land-foot">
        <div className="stack-sm" style={{ gap: 8 }}>
          <div className="logo" style={{ color: 'var(--inkx)' }}><LogoMark size={26} a="#147A4B" b="#2F5BFF" /><span>BioLoop</span></div>
          <span>Questions or partnerships: <a href="mailto:bioloopteam@gmail.com">bioloopteam@gmail.com</a></span>
        </div>
        <p className="credits">
          <Link to="/privacy">Privacy policy</Link> <span aria-hidden="true">|</span> © {new Date().getFullYear()} BioLoop. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
