import { Link } from 'react-router-dom';
import { LogoMark } from '../ui/Icon.jsx';
import Icon from '../ui/Icon.jsx';

// Free photos from Unsplash (Unsplash License). Each sits on a colour block,
// so the layout still holds if a photo is slow or fails to load.
const u = (id, w = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;
const PHOTO = {
  phoneGirl: 'photo-1680879275304-bbe20f7e28fb', // Ahmed Nasiru
  phoneWoman: 'photo-1553448056-b6146f67f31c', // Segun Osunyomi
  lagosVan: 'photo-1636063448667-a42a681a7847', // Ben Iwara, Lagos
  lagosStreet: 'photo-1572816225927-d08fb138f2b2', // Muhammad-Taha Ibrahim, Lagos
  friends: 'photo-1744320911030-1ab998d994d7', // Leiada Krözjhen
  threeWomen: 'photo-1565490129165-bd6a24996c25', // Muhammad-Taha Ibrahim
  colourBins: 'photo-1611284446314-60a58ac0deb9', // Nareeta Martin
  lidBins: 'photo-1786238064936-e08bd8046e18', // Julian Gojani
};

function Img({ id, w, alt, ...rest }) {
  return <img src={u(id, w)} alt={alt} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} {...rest} />;
}

export default function Landing() {
  return (
    <div className="land">
      <header className="land-nav">
        <Link to="/welcome" className="logo" aria-label="BioLoop">
          <LogoMark size={32} a="#147A4B" b="#2F5BFF" />
          <span>BioLoop</span>
        </Link>
        <nav className="links" aria-label="Site">
          <a className="plain" href="#how">How it works</a>
          <a className="plain" href="#who">Who it's for</a>
          <Link to="/login" className="btn ghost sm" style={{ height: 40 }}>Sign in</Link>
          <Link to="/register" className="btn pink sm" style={{ height: 40 }}>Get started</Link>
        </nav>
      </header>

      <main>
        <section className="land-wrap land-hero">
          <div>
            <h1>Bins that speak up before they spill.</h1>
            <p className="lede">
              BioLoop puts sensors inside sorted bins across Lagos. You can see how full yours is, it locks itself before it overflows,
              and the collector gets pinged to come. Sort right and earn Loop points.
            </p>
            <div className="cta">
              <Link to="/register" className="btn big">Join as a resident</Link>
              <Link to="/login" className="btn big ghost">Sign in</Link>
            </div>
            <div className="trust">
              <div className="faces" aria-hidden="true">
                <span style={{ backgroundImage: `url(${u(PHOTO.phoneGirl, 120)})` }} />
                <span style={{ backgroundImage: `url(${u(PHOTO.threeWomen, 120)})` }} />
                <span style={{ backgroundImage: `url(${u(PHOTO.phoneWoman, 120)})` }} />
              </div>
              <span>Built at UNILAG, made for Lagos streets, markets and campuses.</span>
            </div>
          </div>

          <div className="collage" aria-label="People using BioLoop and the BioLoop smart bin">
            <div className="ph a"><Img id={PHOTO.phoneGirl} w={800} alt="Young woman checking her phone" /></div>
            <div className="ph b"><Img id={PHOTO.lidBins} w={700} alt="Three waste bins with coloured lids" /></div>
            <div className="binshot"><img src="/img/bioloop-bin.png" alt="The BioLoop three-compartment smart bin" /></div>
            <span className="sticker pink s1">Organic is 91% full</span>
            <span className="sticker mint r s2"><Icon name="truck" size={16} />Truck on the way</span>
            <span className="sticker sun s3">+10 Loop points</span>
          </div>
        </section>

        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[0, 1].map((k) => (
              <span key={k}>
                <span><i style={{ background: '#FFC21A' }} />Sort it</span>
                <span><i style={{ background: '#2F5BFF' }} />Drop it</span>
                <span><i style={{ background: '#1F9D5A' }} />The bin watches</span>
                <span><i style={{ background: '#FF8CC6' }} />The truck comes</span>
                <span><i style={{ background: '#FF9A6B' }} />No more overflow</span>
              </span>
            ))}
          </div>
        </div>

        <section className="land-wrap land-sec problem">
          <figure className="shot" style={{ margin: 0 }}>
            <img src="/img/jaja-overflow.jpg" alt="Waste spilling around public bins at Jaja Complex, University of Lagos" loading="lazy" />
            <figcaption>Jaja Complex, University of Lagos. This is what we are fixing.</figcaption>
          </figure>
          <div>
            <h2>The bin was full on Monday. The truck came on Friday.</h2>
            <p className="sub">
              Nobody knows a bin is full until it is spilling into the gutter. Then comes the smell, the flies, the blocked drains and the flooding.
              Collectors drive fixed routes and still miss the bins that matter.
            </p>
            <div className="facts">
              <div className="fact pink"><b>32M+</b><p>tonnes of waste Nigeria generates every year</p></div>
              <div className="fact sun"><b>&lt;40%</b><p>of it is properly collected. The rest overflows or gets dumped.</p></div>
            </div>
            <p className="src">Figures reported by Punch Newspapers.</p>
          </div>
        </section>

        <section id="how" className="land-wrap land-sec" style={{ paddingTop: 20 }}>
          <h2>Three bins. One sensor brain. Zero overflow.</h2>
          <p className="sub">Every BioLoop station has general, recyclables and organic compartments. Here is what happens to your waste.</p>
          <div className="steps">
            <article className="step">
              <span className="n">1</span>
              <h3>You sort at the bin</h3>
              <p>Wrappers and nylon in yellow. Bottles, cans and paper in blue. Food scraps and peels in green. The app shows which side has room.</p>
              <div className="demo row" style={{ gap: 8 }}>
                <span className="sticker sun">General</span><span className="sticker blue r">Recyclables</span><span className="sticker mint">Organic</span>
              </div>
            </article>
            <article className="step">
              <span className="n">2</span>
              <h3>The bin watches itself</h3>
              <p>Solar-powered sensors check every compartment all day. At 75% a pickup is requested. At 90% the lid locks so nothing spills.</p>
              <div className="demo stack-sm">
                <div className="bar"><div style={{ width: '91%', background: '#1F9D5A' }} /></div>
                <span className="sticker coral" style={{ alignSelf: 'flex-start' }}><Icon name="lock" size={14} />Organic locked at 91%</span>
              </div>
            </article>
            <article className="step">
              <span className="n">3</span>
              <h3>The right truck comes</h3>
              <p>Collectors get a route sorted by urgency. Sorted recyclables go straight to local recyclers instead of the dumpsite.</p>
              <div className="demo"><span className="sticker pink r"><Icon name="truck" size={14} />CleanRoute arriving 2:30 PM</span></div>
            </article>
          </div>
        </section>

        <section id="who" className="land-wrap land-sec">
          <h2>One loop, four kinds of people.</h2>
          <div className="roles">
            <article className="role">
              <div className="img"><Img id={PHOTO.phoneWoman} w={600} alt="Woman using a smartphone outdoors" /></div>
              <div className="body">
                <h3>Residents</h3>
                <p>See your bin's fill level live, get pinged before it locks, report problems and earn points you can redeem.</p>
              </div>
            </article>
            <article className="role">
              <div className="img"><Img id={PHOTO.lagosVan} w={600} alt="A man driving a van down a Lagos street" /></div>
              <div className="body">
                <h3>Collectors</h3>
                <p>Today's route, sorted by which bins are locked. Tell residents when you are coming and log what you collected.</p>
              </div>
            </article>
            <article className="role">
              <div className="img"><Img id={PHOTO.colourBins} w={600} alt="Red, yellow and green recycling bins" /></div>
              <div className="body">
                <h3>Recyclers</h3>
                <p>Clean, sorted PET, cans, paper and organics, listed by weight and area. Reserve a batch in one tap.</p>
              </div>
            </article>
            <article className="role">
              <div className="img"><Img id={PHOTO.lagosStreet} w={600} alt="A busy street in Lagos" /></div>
              <div className="body">
                <h3>Waste agencies</h3>
                <p>A live map of every station, what needs pickup, who is assigned and how much was collected this week.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="land-wrap land-sec" style={{ paddingTop: 10 }}>
          <div className="bigcta">
            <div>
              <h2>Your street deserves better than overflow.</h2>
              <p className="sub">Find the BioLoop bin near you, add its code, and we will keep you posted.</p>
              <div className="row wrap" style={{ marginTop: 26, gap: 12 }}>
                <Link to="/register" className="btn big pink">Create my account</Link>
                <Link to="/login" className="btn big white">I already have one</Link>
              </div>
            </div>
            <div className="crowd"><Img id={PHOTO.friends} w={800} alt="A group of smiling friends sitting on steps" /></div>
          </div>
        </section>
      </main>

      <footer className="land-wrap land-foot">
        <div className="stack-sm" style={{ gap: 6 }}>
          <div className="logo"><LogoMark size={26} a="#147A4B" b="#2F5BFF" /><span style={{ fontSize: 18 }}>BioLoop</span></div>
          <span>Questions or partnerships: <a href="mailto:bioloopteam@gmail.com">bioloopteam@gmail.com</a></span>
        </div>
        <p className="credits">
          Photos from Unsplash by Ahmed Nasiru, Segun Osunyomi, Ben Iwara, Muhammad-Taha Ibrahim, Leiada Krözjhen, Nareeta Martin and Julian Gojani.
          Jaja Complex photo and bin render by Team BioLoop.
        </p>
      </footer>
    </div>
  );
}
