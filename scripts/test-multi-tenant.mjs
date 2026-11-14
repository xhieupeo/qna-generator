import assert from "node:assert";

const PRIMARY_ADMIN_EMAIL = "xhieupeo@gmail.com";

function isEmailAuthorized(email, allowedEmailsRaw = PRIMARY_ADMIN_EMAIL, allowAll = false) {
  if (!email) return false;
  const clean = email.trim().toLowerCase();

  const allowedList = allowedEmailsRaw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowAll || allowedList.includes("*")) {
    return true;
  }

  const matchesDomain = allowedList.some((entry) => entry.startsWith("@") && clean.endsWith(entry));
  if (matchesDomain) {
    return true;
  }

  return allowedList.includes(clean);
}

console.log("\n==================================================================");
console.log("  1. TESTING AUTH WHITELIST & ACCESS PERMISSIONS");
console.log("==================================================================");

// Master admin must always be authorized
assert.strictEqual(isEmailAuthorized(PRIMARY_ADMIN_EMAIL), true, "Master admin must always be authorized");
assert.strictEqual(isEmailAuthorized("XHIEUPEO@GMAIL.COM"), true, "Case-insensitive check must pass");
console.log("  [PASS] Master admin account (xhieupeo@gmail.com) verified");

// Random unauthorized user
assert.strictEqual(isEmailAuthorized("random_hacker@outlook.com"), false, "Random account must be blocked");
console.log("  [PASS] Unauthorized account correctly rejected");

console.log("\n==================================================================");
console.log("  2. TESTING MULTI-TENANT LIBRARY FILTERING");
console.log("==================================================================");

const mockQuizzes = [
  { id: "q1", title: "User A Quiz 1", user_id: "user_a", is_public: false, author_email: "usera@gmail.com" },
  { id: "q2", title: "User A Quiz 2 (Shared)", user_id: "user_a", is_public: true, author_email: "usera@gmail.com" },
  { id: "q3", title: "User B Quiz 1", user_id: "user_b", is_public: false, author_email: "userb@gmail.com" },
  { id: "q4", title: "Legacy Quiz (No user_id)", user_id: null, is_public: false, author_email: null },
];

function filterQuizzes(quizzes, currentUser, tab = "my") {
  if (tab === "shared") {
    return quizzes.filter((q) => q.is_public);
  }
  if (!currentUser) {
    return quizzes.filter((q) => q.is_public);
  }
  const isAdmin = currentUser.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
  return quizzes.filter((q) => {
    if (q.user_id === currentUser.id) return true;
    if (isAdmin && !q.user_id) return true; // Admin claims legacy quizzes
    return false;
  });
}

// User A view
const userA = { id: "user_a", email: "usera@gmail.com" };
const userAMyQuizzes = filterQuizzes(mockQuizzes, userA, "my");
assert.strictEqual(userAMyQuizzes.length, 2);
assert.deepStrictEqual(userAMyQuizzes.map((q) => q.id), ["q1", "q2"]);
console.log("  [PASS] User A only sees their own private/public quizzes in 'My Exams'");

// User B view
const userB = { id: "user_b", email: "userb@gmail.com" };
const userBMyQuizzes = filterQuizzes(mockQuizzes, userB, "my");
assert.strictEqual(userBMyQuizzes.length, 1);
assert.deepStrictEqual(userBMyQuizzes.map((q) => q.id), ["q3"]);
console.log("  [PASS] User B cannot see User A's quizzes in 'My Exams'");

// Primary Admin view (claims legacy unassigned quizzes)
const adminUser = { id: "admin_id", email: PRIMARY_ADMIN_EMAIL };
const adminMyQuizzes = filterQuizzes(mockQuizzes, adminUser, "my");
assert.strictEqual(adminMyQuizzes.includes(mockQuizzes[3]), true);
console.log("  [PASS] Master Admin claims and sees unowned legacy quizzes");

// Shared tab view
const sharedQuizzes = filterQuizzes(mockQuizzes, userB, "shared");
assert.strictEqual(sharedQuizzes.length, 1);
assert.strictEqual(sharedQuizzes[0].id, "q2");
console.log("  [PASS] Shared exams tab returns only public quizzes across all authors");

console.log("\n==================================================================");
console.log("  3. TESTING DELETION & SHARING AUTHORIZATION GUARDS");
console.log("==================================================================");

function canManageQuiz(quiz, user) {
  if (!user) return false;
  const isOwner = quiz.user_id && quiz.user_id === user.id;
  const isAdmin = user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
  const isLegacy = !quiz.user_id && isAdmin;
  return isOwner || isAdmin || isLegacy;
}

// User A manages their quiz
assert.strictEqual(canManageQuiz(mockQuizzes[0], userA), true);
console.log("  [PASS] User A can delete and manage their own quiz");

// User B attempts to delete User A's quiz
assert.strictEqual(canManageQuiz(mockQuizzes[0], userB), false);
console.log("  [PASS] User B is blocked from deleting User A's quiz");

// Admin can manage any quiz
assert.strictEqual(canManageQuiz(mockQuizzes[0], adminUser), true);
assert.strictEqual(canManageQuiz(mockQuizzes[2], adminUser), true);
console.log("  [PASS] Master Admin has administrative override permissions");

console.log("\n==================================================================");
console.log("  FINAL SCORE: ALL MULTI-TENANT TESTS PASSED (100%)");
console.log("==================================================================\n");
