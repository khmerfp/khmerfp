
import React from 'react'
import './Terms.css'

const Terms = () => {
  return (
    <main className="terms-page">
      <div className="terms-container">
        <header className="terms-header">
          <span className="terms-label">LEGAL INFORMATION</span>
          <h1>Terms of Service</h1>
          <p className="terms-updated">
            Last updated: November 2, 2026
          </p>
          <p className="terms-intro">
            Welcome to KhmerFP. These Terms of Service explain
            the rules and conditions for accessing and using
            our website and services. By accessing or using
            KhmerFP, you agree to these terms.
          </p>
        </header>

        <section className="terms-section">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing, registering for, or using KhmerFP,
            you acknowledge that you have read, understood,
            and agreed to these Terms of Service and our
            Privacy Policy.
          </p>
          <p>
            If you do not agree with these terms, please
            discontinue using our services.
          </p>
        </section>

        <section className="terms-section">
          <h2>2. Eligibility and User Accounts</h2>
          <p>
            You must be legally capable of entering into a
            binding agreement to use our services.
          </p>
          <ul>
            <li>
              You must provide accurate and current
              information when creating an account.
            </li>
            <li>
              You are responsible for maintaining the
              confidentiality of your account and login
              credentials.
            </li>
            <li>
              You must notify us if you suspect unauthorized
              access to your account.
            </li>
            <li>
              You must not impersonate another person or
              create an account using false information.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>3. Login and Authentication</h2>
          <p>
            KhmerFP may provide account authentication
            through supported third-party services,
            including Google and Facebook.
          </p>
          <p>
            When you use third-party authentication, you
            are also subject to the applicable terms and
            policies of those providers.
          </p>
          <p>
            We do not control third-party authentication
            services and cannot guarantee their continuous
            availability.
          </p>
        </section>

        <section className="terms-section">
          <h2>4. Payments and Transactions</h2>
          <p>
            KhmerFP may provide payment-related services
            and transaction functionality through supported
            payment providers.
          </p>
          <ul>
            <li>
              You are responsible for verifying transaction
              details before confirming a payment.
            </li>
            <li>
              Transactions are subject to the availability
              and rules of the relevant payment provider.
            </li>
            <li>
              You must not use the platform for fraudulent,
              unauthorized, or illegal transactions.
            </li>
            <li>
              Transaction confirmation and status may depend
              on verification from the payment provider.
            </li>
          </ul>
          <p>
            Any applicable payment fees, refund conditions,
            cancellation rules, and transaction limits will
            be communicated through the relevant service
            or transaction process.
          </p>
        </section>

        <section className="terms-section">
          <h2>5. Prohibited Activities</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use KhmerFP for unlawful activities or fraud.</li>
            <li>
              Attempt to access another user's account
              without authorization.
            </li>
            <li>
              Interfere with or disrupt the platform,
              servers, or security systems.
            </li>
            <li>
              Upload malicious software or harmful content.
            </li>
            <li>
              Exploit vulnerabilities or attempt to bypass
              authentication and security controls.
            </li>
            <li>
              Use the service in a way that violates
              applicable laws or third-party rights.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>6. Account Suspension and Termination</h2>
          <p>
            We reserve the right to restrict, suspend, or
            terminate access to an account if we reasonably
            believe that the account:
          </p>
          <ul>
            <li>Violates these Terms of Service.</li>
            <li>Is involved in fraudulent or unauthorized activity.</li>
            <li>
              Creates security risks or harms other users.
            </li>
            <li>
              Is used in violation of applicable laws.
            </li>
          </ul>
          <p>
            Where appropriate and legally permitted, we may
            provide notice and an opportunity to resolve
            the issue.
          </p>
        </section>

        <section className="terms-section">
          <h2>7. Third-Party Services</h2>
          <p>
            Our platform may integrate with third-party
            services, including authentication providers,
            payment providers, and other external services.
          </p>
          <p>
            These services operate independently and may
            have their own terms, privacy policies,
            availability requirements, and limitations.
          </p>
        </section>

        <section className="terms-section">
          <h2>8. Privacy and Personal Information</h2>
          <p>
            We collect and process personal information
            according to our Privacy Policy.
          </p>
          <p>
            Please review our{' '}
            <a href="/privacy-policy">Privacy Policy</a>
            {' '}to understand how your information is
            collected, used, stored, and protected.
          </p>
        </section>

        <section className="terms-section">
          <h2>9. Service Availability</h2>
          <p>
            We aim to maintain reliable access to KhmerFP.
            However, we do not guarantee that the platform
            will always be available, uninterrupted,
            secure, or error-free.
          </p>
          <p>
            Maintenance, technical issues, network failures,
            and third-party service interruptions may
            temporarily affect availability.
          </p>
        </section>

        <section className="terms-section">
          <h2>10. Limitation of Liability</h2>
          <p>
            To the extent permitted by applicable law,
            KhmerFP and its operators will not be liable
            for indirect, incidental, or consequential
            damages arising from the use or inability to
            use the platform.
          </p>
          <p>
            Nothing in these terms excludes liability that
            cannot legally be excluded or limited.
          </p>
        </section>

        <section className="terms-section">
          <h2>11. Changes to These Terms</h2>
          <p>
            We may update these Terms of Service from time
            to time to reflect changes to our services,
            business operations, or legal requirements.
          </p>
          <p>
            Updated terms will be published on this page
            with a revised last-updated date. Your continued
            use of the platform after changes take effect
            is subject to the updated terms, where
            permitted by applicable law.
          </p>
        </section>

        <section className="terms-section">
          <h2>12. Governing Law</h2>
          <p>
            These terms are subject to the applicable laws
            and regulations governing the services.
            Any disputes will be handled through the
            appropriate legal processes under applicable law.
          </p>
        </section>

        <section className="terms-contact">
          <h2>13. Contact Us</h2>
          <p>
            If you have questions about these Terms of
            Service, please contact us:
          </p>
          <p><strong>Platform:</strong> KhmerFP</p>
          <p>
            <strong>Website:</strong>{' '}
            <a href="https://khmerfp.com">
              https://khmerfp.com
            </a>
          </p>
          <p>
            <strong>Email:</strong>{' '}
            <a href="mailto:bighkhmerfp@gmail.com">
              bighkhmerfp@gmail.com
            </a>
          </p>
        </section>

        <footer className="terms-footer">
          <p>© {new Date().getFullYear()} KhmerFP. All rights reserved.</p>
          <a href="/privacy-policy">Privacy Policy</a>
        </footer>
      </div>
    </main>
  )
}

export default Terms

