"use client";

import { FormEvent, useState } from "react";

type ResidentFormsProps = {
  type: "contact" | "newsletter" | "survey";
};

const labels = {
  contact: "Message received. Thank you for contacting the district office.",
  newsletter:
    "Newsletter signup received. Thank you for staying connected.",
  survey:
    "Survey response received. Thank you for sharing your feedback."
};

export function ResidentForm({ type }: ResidentFormsProps) {
  const [status, setStatus] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(labels[type]);
    event.currentTarget.reset();
  }

  if (type === "newsletter") {
    return (
      <form className="form-panel" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="newsletter-name">Full name</label>
            <input id="newsletter-name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="newsletter-email">Email address</label>
            <input id="newsletter-email" name="email" required type="email" />
          </div>
          <div className="field">
            <label htmlFor="newsletter-zip">ZIP code</label>
            <input id="newsletter-zip" name="zip" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="newsletter-topic">Primary interest</label>
            <select id="newsletter-topic" name="topic">
              <option>District events</option>
              <option>Legislative updates</option>
              <option>Constituent services</option>
            </select>
          </div>
        </div>
        <button className="cta-link" type="submit">
          Join Newsletter
        </button>
        {status ? <p className="form-note" role="status">{status}</p> : null}
      </form>
    );
  }

  if (type === "survey") {
    return (
      <form className="form-panel" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="survey-name">Full name</label>
            <input id="survey-name" name="name" />
          </div>
          <div className="field">
            <label htmlFor="survey-neighborhood">Neighborhood</label>
            <input id="survey-neighborhood" name="neighborhood" required />
          </div>
          <div className="field">
            <label htmlFor="survey-priority">Top priority</label>
            <select id="survey-priority" name="priority">
              <option>Affordability</option>
              <option>Public safety</option>
              <option>Schools and youth</option>
              <option>Transportation</option>
              <option>Healthcare</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="survey-contact">May the office follow up?</label>
            <select id="survey-contact" name="followup">
              <option>Yes</option>
              <option>No</option>
            </select>
          </div>
          <div className="field full">
            <label htmlFor="survey-comments">Comments</label>
            <textarea id="survey-comments" name="comments" />
          </div>
        </div>
        <button className="cta-link" type="submit">
          Submit Feedback
        </button>
        {status ? <p className="form-note" role="status">{status}</p> : null}
      </form>
    );
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="contact-name">Full name</label>
          <input id="contact-name" name="name" required />
        </div>
        <div className="field">
          <label htmlFor="contact-email">Email address</label>
          <input id="contact-email" name="email" required type="email" />
        </div>
        <div className="field">
          <label htmlFor="contact-phone">Phone number</label>
          <input id="contact-phone" name="phone" type="tel" />
        </div>
        <div className="field">
          <label htmlFor="contact-topic">Topic</label>
          <select id="contact-topic" name="topic">
            <option>State agency assistance</option>
            <option>Event invitation</option>
            <option>Legislative feedback</option>
            <option>General question</option>
          </select>
        </div>
        <div className="field full">
          <label htmlFor="contact-message">Message</label>
          <textarea id="contact-message" name="message" required />
        </div>
      </div>
      <button className="cta-link" type="submit">
        Submit Message
      </button>
      {status ? <p className="form-note" role="status">{status}</p> : null}
    </form>
  );
}
