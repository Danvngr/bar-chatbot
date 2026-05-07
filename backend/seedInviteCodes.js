require("dotenv").config();
const { createInviteCode } = require("./src/services/inviteCodes");

async function run() {
  const rawCount = Number(process.argv[2] || "5");
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 5;
  const customCodes = process.argv.slice(3).map((c) => String(c || "").trim()).filter(Boolean);

  try {
    const created = [];

    if (customCodes.length > 0) {
      for (const code of customCodes) {
        created.push(await createInviteCode(code));
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        created.push(await createInviteCode());
      }
    }

    console.log("Invite codes created:");
    created.forEach((code) => console.log(`- ${code}`));
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed invite codes:", error.message);
    process.exit(1);
  }
}

run();
