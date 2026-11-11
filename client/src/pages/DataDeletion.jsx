
import React from 'react'
import './DataDeletion.css'

function DataDeletion() {
  const supportEmail = 'sanok.payang@student.passerellesnumeriques.org'
  

  return (
    <div className="deletion-page">
      <div className="deletion-container">
        <div className="deletion-icon">🔒</div>

        <h1>Data Deletion Instructions</h1>

        <p className="deletion-intro">
          At KhmerFP, we respect your privacy and your right
          to control your personal information.
        </p>

        <section>
          <h2>How to Request Account Deletion</h2>

          <p>
            If you want to delete your KhmerFP account and
            associated personal information, follow these steps:
          </p>

          <ol>
            <li>Send an email to our support team.</li>
            <li>Use the email address associated with your KhmerFP account.</li>
            <li>Write "Account and Data Deletion Request" as the subject.</li>
            <li>Our team will verify your identity and process your request.</li>
            <li>We will notify you when your request has been completed.</li>
          </ol>
        </section>

        <section>
          <h2>Request Data Deletion</h2>

          <p>
            Contact our support team to request deletion
            of your account and personal information.
          </p>

          <a
            className="deletion-button"
            href={`mailto:${supportEmail}?subject=${encodeURIComponent(
              'Account and Data Deletion Request'
            )}`}
          >
            Request Account Deletion
          </a>
        </section>

        <section>
          <h2>Information That May Be Deleted</h2>

          <ul>
            <li>Your KhmerFP account information</li>
            <li>Your name and email address</li>
            <li>Your linked Facebook account information</li>
            <li>Other personal information associated with your account</li>
          </ul>
        </section>

        <section>
          <h2>Data Retention</h2>

          <p>
            Some information may be retained when required by
            applicable laws, regulations, security requirements,
            or legitimate financial record-keeping obligations.
          </p>
        </section>

        <section>
          <h2>Contact Us</h2>

          <p>
            If you have questions about your personal data,
            please contact us:
          </p>

          <p>
            Email:{' '}
            <a href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          </p>
        </section>

        <footer>
          © {new Date().getFullYear()} KhmerFP. All rights reserved.
        </footer>
      </div>
    </div>
  )
}

export default DataDeletion
