import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="landing-page">
      <header className="landing-topbar">
        <div className="brand">{t("app.brand")}</div>
        <div className="landing-auth-actions">
          <Link to="/auth" className="secondary-btn">
            {t("auth.login")}
          </Link>
          <Link to="/auth" className="primary-btn">
            {t("auth.signup")}
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div>
          <h1>{t("landing.heroTitle")}</h1>
          <p>{t("landing.heroSubtitle")}</p>
          <Link to="/auth" className="primary-btn">
            {t("landing.getStarted")}
          </Link>
        </div>
        <div className="hero-infographic">
          <div className="hero-node">Clean</div>
          <div className="hero-node">Train</div>
          <div className="hero-node">Evaluate</div>
          <div className="hero-node">Predict</div>
        </div>
      </section>

      <section className="landing-section">
        <h2>{t("landing.aboutTitle")}</h2>
        <p>{t("landing.aboutText")}</p>
      </section>

      <section className="landing-section">
        <h2>{t("landing.featuresTitle")}</h2>
        <ul className="landing-features">
          <li>{t("landing.feature1")}</li>
          <li>{t("landing.feature2")}</li>
          <li>{t("landing.feature3")}</li>
          <li>{t("landing.feature4")}</li>
        </ul>
      </section>

      <section className="landing-section">
        <h2>{t("landing.contactTitle")}</h2>
        <p>{t("landing.contactText")}</p>
      </section>

      <footer className="landing-footer">{t("landing.footer")}</footer>
    </div>
  );
}

export default LandingPage;
