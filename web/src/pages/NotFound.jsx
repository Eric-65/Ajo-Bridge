import { Cta, Eyebrow } from '../components/ui.jsx';

export function NotFoundPage() {
  return (
    <section className="section">
      <div className="wrap stack stack--lg">
        <Eyebrow>404</Eyebrow>
        <h1 className="display">Nothing at this address.</h1>
        <Cta to="/" className="cta--auto">Back to start</Cta>
      </div>
    </section>
  );
}
