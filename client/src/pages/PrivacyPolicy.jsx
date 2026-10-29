
import React from "react";
import "./PrivacyPolicy.css";

const PrivacyPolicy = () => {
  const lastUpdated = "October 29, 2026";

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <a href="/" className="privacy-brand">
          <span className="privacy-logo">K</span>
          <span>Khmer<span className="privacy-fp">FP</span></span>
        </a>

        <a href="/" className="privacy-home">
          Back to Home
        </a>
      </header>

      <article className="privacy-content">
        <span className="privacy-label">LEGAL INFORMATION</span>

        <h1>Privacy Policy</h1>

        <p className="privacy-updated">
          Last updated: {lastUpdated}
        </p>

        <p>
          Welcome to KhmerFP. We respect your privacy and are
          committed to protecting your personal information.
          This Privacy Policy explains how we collect, use,
          store, and protect information when you use our website.
        </p>

        <section>
          <h2>1. Information We Collect</h2>
          <p>
            Depending on the features you use, KhmerFP may collect
            the following information:
          </p>
          <ul>
            <li>
              <strong>Account information:</strong> Your name,
              email address, and profile picture when provided
              through a supported sign-in method.
            </li>
            <li>
              <strong>Facebook sign-in information:</strong> Your
              Facebook account identifier and the basic profile
              information you authorize us to access.
            </li>
            <li>
              <strong>Technical information:</strong> Information
              needed to operate, secure, and troubleshoot our website.
            </li>
          </ul>
          <p>
            The information we receive depends on the permissions
            you grant and the information available from your
            account. We do not automatically receive every detail
            of your Facebook profile.
          </p>
        </section>

        <section>
          <h2>2. How We Use Your Information</h2>
          <p>We may use your information to:</p>
          <ul>
            <li>Create and manage your KhmerFP account.</li>
            <li>Authenticate you when you sign in.</li>
            <li>Maintain account sessions and account security.</li>
            <li>Operate, maintain, and improve our services.</li>
            <li>Respond to support requests and security issues.</li>
            <li>Meet applicable legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2>3. Facebook Login</h2>
          <p>
            KhmerFP may offer Facebook Login to help you access
            your account. When you choose this option, Meta may
            share information with us according to the permissions
            you authorize.
          </p>
          <p>
            We use the information received to authenticate your
            account and provide the requested website functionality.
            Facebook Login is subject to Meta's own policies and
            terms.
          </p>
          <p>
            You can review Meta's privacy policy at{" "}
            <a
              href="https://www.facebook.com/privacy/policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Meta Privacy Policy
            </a>.
          </p>
        </section>

        <section>
          <h2>4. Storage and Security</h2>
          <p>
            Account information may be stored in our database
            and processed by the services used to operate KhmerFP.
            We use reasonable security measures intended to protect
            information against unauthorized access, loss, or misuse.
          </p>
          <p>
            No online service can guarantee absolute security.
          </p>
        </section>

        <section>
          <h2>5. Sharing of Information</h2>
          <p>
            We do not sell your personal information. Information
            may be processed by service providers that help us
            operate, host, secure, or maintain KhmerFP, or disclosed
            when required by law.
          </p>
        </section>

        <section>
          <h2>6. Data Retention and Deletion</h2>
          <p>
            We retain personal information for as long as reasonably
            necessary to provide our services, meet legal obligations,
            resolve disputes, and maintain security.
          </p>
          <p>
            You may request deletion of your account information
            by contacting us using the contact details below.
            We will review and process requests in accordance with
            applicable laws and any legitimate retention requirements.
          </p>
        </section>

        <section>
          <h2>7. Your Choices</h2>
          <p>
            You may stop using KhmerFP at any time. You can also
            manage permissions for connected applications through
            the relevant third-party platform where those controls
            are available.
          </p>
        </section>

        <section>
          <h2>8. Children's Privacy</h2>
          <p>
            KhmerFP is not intended for children who are not
            permitted to use the service under applicable law.
            We do not knowingly collect personal information from
            children in violation of applicable requirements.
          </p>
        </section>

        <section>
          <h2>9. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy when our services
            or legal requirements change. The latest version will
            be published on this page with its updated date.
          </p>
        </section>

        <section>
          <h2>10. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or
            want to request deletion of your personal information,
            contact us at:
          </p>
          <p>
            <strong>Website:</strong>{" "}
            <a href="https://khmerfp.com">
              https://khmerfp.com
            </a>
          </p>
          <p>
            <strong>Email:</strong>{" "}
            <a href="mailto:YOUR_SUPPORT_EMAIL">
              YOUR_SUPPORT_EMAIL
            </a>
          </p>
          <p className="privacy-note">
            Replace YOUR_SUPPORT_EMAIL with a real email address
            that you monitor before publishing this page.
          </p>
        </section>
      </article>

      <footer className="privacy-footer">
        © {new Date().getFullYear()} KhmerFP. All rights reserved.
      </footer>
    </main>
  );
};

export default PrivacyPolicy;
