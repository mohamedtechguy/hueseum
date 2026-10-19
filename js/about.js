/* =====================================================================
   Hueseum: About page
   Feedback form with validation and a live character counter.
   Hueseum has no server, so feedback is kept in this browser only.
   ===================================================================== */
(function () {
  "use strict";

  const H = window.Hueseum;
  const { forms } = H;

  const form = document.getElementById("feedback-form");
  const nameInput = document.getElementById("fb-name");
  const emailInput = document.getElementById("fb-email");
  const message = document.getElementById("fb-message");
  const ratingError = document.getElementById("rating-error");
  const status = document.getElementById("feedback-status");

  const updateCounter = forms.attachCounter(message, document.getElementById("fb-message-count"));

  // A practical email check: something@something.something, no spaces
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const rules = [
    [nameInput, (v) => (v.trim() ? "" : "Enter your name.")],
    [emailInput, (v) => {
      if (!v.trim()) return "Enter your email address.";
      return EMAIL.test(v.trim()) ? "" : "Enter an email address like name@example.com.";
    }],
    [message, (v) => {
      if (!v.trim()) return "Write a message.";
      return v.trim().length < 10 ? "Write at least 10 characters so we understand the problem." : "";
    }]
  ];

  function check(input, rule) {
    const problem = rule(input.value);
    if (problem) forms.showError(input, problem);
    else forms.clearError(input);
    return problem;
  }

  rules.forEach(([input, rule]) => {
    input.addEventListener("blur", () => { if (input.value) check(input, rule); });
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") check(input, rule);
    });
  });

  form.addEventListener("change", (event) => {
    if (event.target.name === "rating") ratingError.textContent = "";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "";

    let firstInvalid = null;
    rules.forEach(([input, rule]) => {
      if (check(input, rule) && !firstInvalid) firstInvalid = input;
    });

    const rating = form.querySelector('input[name="rating"]:checked');
    if (!rating) {
      ratingError.textContent = "Choose a rating from 1 to 5.";
      if (!firstInvalid) firstInvalid = form.querySelector('input[name="rating"]');
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const data = new FormData(form);
    const saved = H.storage.get("hueseum.feedback", []);
    saved.push({
      name: data.get("name"),
      email: data.get("email"),
      rating: Number(data.get("rating")),
      topic: data.get("topic"),
      message: data.get("message"),
      at: new Date().toISOString()
    });
    H.storage.set("hueseum.feedback", saved);

    const firstName = nameInput.value.trim().split(/\s+/)[0];
    form.reset();
    updateCounter();
    status.textContent = "Thank you, " + firstName + ". Your feedback is saved in this browser.";
    status.focus();
  });
})();
