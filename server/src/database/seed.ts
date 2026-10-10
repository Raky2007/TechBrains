import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { setupDatabase } from './setup.js';

export async function seedDatabase(): Promise<void> {
  await setupDatabase();
  const db = getDb();
  console.log('[Seed] Seeding sample Level 1 questions and Level 2 case...');

  const now = new Date().toISOString();

  // Clear existing sample questions to allow clean re-seeding
  const existingQuestions = db.prepare('SELECT COUNT(*) as count FROM level1_questions').get() as { count: number };
  if (existingQuestions.count === 0) {
    const questions = [
      {
        title: "Subject Alpha: Neural Portrait Analysis",
        prompt: "Analyze the portrait photograph of a conference keynote speaker. Examine corneal light reflections, earlobe symmetry, and fine textile textures at collar edge.",
        content_type: "text",
        media_path: null,
        correct_answer: "AI",
        explanation: "Reflections in the left and right pupils show completely conflicting light sources (one rectangular softbox, one outdoor horizon). Earlobe folds dissolve into the jawline without anatomical cartilage separation.",
        category: "Synthetic Imagery",
        difficulty: "medium"
      },
      {
        title: "Artifact Beta: Apollo 11 Lunar Module Descent Log",
        prompt: "Examine this transcribed voice loop and telemetry transcript from the Lunar Module 'Eagle' descent phase: '1202 alarm... 60 feet, down 2 1/2, picking up some dust... contact light.'",
        content_type: "text",
        media_path: null,
        correct_answer: "HUMAN",
        explanation: "Authentic historical NASA flight transcripts containing documented human telemetry jargon, genuine voice-stress ellipsis, and verifiable Apollo Guidance Computer executive overload codes (1202).",
        category: "Aviation & Space",
        difficulty: "easy"
      },
      {
        title: "Subject Gamma: Autonomous Drone Firmware Patch",
        prompt: "Review the C++ driver code snippet for an optical flow flight controller. Note function headers, bitwise shift operations, and error-handling routines.",
        content_type: "text",
        media_path: null,
        correct_answer: "AI",
        explanation: "The snippet hallucinated non-existent hardware registers (REG_OPT_GYRO_DMA_V4) and included generic boilerplate comments characteristic of GPT-4 code synthesis without compiler validation.",
        category: "Source Code",
        difficulty: "hard"
      },
      {
        title: "Subject Delta: Distant Security Camera Snapshot",
        prompt: "Examine this heavily pixelated, 160x120 CCTV still of a vehicle license plate through heavy rain and digital compression artifacts.",
        content_type: "text",
        media_path: null,
        correct_answer: "CANT_DEFINE",
        explanation: "The signal-to-noise ratio is beneath the forensic Nyquist threshold. Compression macroblocking obliterates both synthetic generative artifacts and authentic optical distortion, rendering definitive classification impossible.",
        category: "Forensic Ambiguity",
        difficulty: "medium"
      },
      {
        title: "Subject Epsilon: Academic Abstract on Quantum Error Correction",
        prompt: "Evaluate this scientific paper abstract on surface code topological stabilizers: 'We present a self-correcting 2D lattice minimizing syndrome measurement overhead through non-Abelian anyon braiding...'",
        content_type: "text",
        media_path: null,
        correct_answer: "AI",
        explanation: "While syntactically flawless and authoritative in tone, the abstract references three non-existent citations and blends incompatible theoretical frameworks (combining Abelian surface codes with non-Abelian braiding physics).",
        category: "Academic Literature",
        difficulty: "hard"
      },
      {
        title: "Subject Zeta: Urgent Incident Response Chat Log",
        prompt: "Review the Slack transcript between on-call DevOps engineers during a live database deadlock event: 'Wait who rotated the RDS master secret at 3am? Pagerduty is blowing up.'",
        content_type: "text",
        media_path: null,
        correct_answer: "HUMAN",
        explanation: "Genuine human conversational cadences under high operational stress, featuring idiosyncratic company shorthand, natural typos, and authentic emotional markers.",
        category: "Human Communication",
        difficulty: "easy"
      },
      {
        title: "Subject Eta: Deepfake Audio Phoneme Analysis",
        prompt: "Spectral analysis of a phone call recording reveals pitch transitions occurring at strict 20ms discrete intervals with zero breath inhalation sounds between 40-word sentences.",
        content_type: "text",
        media_path: null,
        correct_answer: "AI",
        explanation: "Biological human vocal tract kinematics cannot produce 40 uninterrupted words without micro-inhalations, and discrete 20ms pitch quantization is the signature of HiFi-GAN vocoder neural synthesis.",
        category: "Voice Forensics",
        difficulty: "medium"
      },
      {
        title: "Subject Theta: Linux Kernel Driver Mailing List Thread",
        prompt: "Read this git commit diff and inline commentary regarding memory barrier reordering in the RISC-V MMU architecture: 'Linus, please pull: this prevents speculative load hazards on SMP cores.'",
        content_type: "text",
        media_path: null,
        correct_answer: "HUMAN",
        explanation: "Authentic Linux kernel subsystem architecture review adhering strictly to Kernel documentation formatting, signed-off-by GPG chains, and deep silicon-level hardware errata knowledge.",
        category: "Systems Engineering",
        difficulty: "hard"
      }
    ];

    const insertQ = db.prepare(`
      INSERT INTO level1_questions (id, title, prompt, content_type, media_path, correct_answer, explanation, category, difficulty, time_limit_seconds, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    for (const q of questions) {
      // Each question gets its own timer; harder questions get a little longer.
      const timeLimit = (q as any).difficulty === 'hard' ? 45 : (q as any).difficulty === 'easy' ? 20 : 30;
      insertQ.run(
        uuidv4(),
        q.title,
        q.prompt,
        q.content_type,
        q.media_path,
        q.correct_answer,
        q.explanation,
        q.category,
        q.difficulty,
        timeLimit,
        now,
        now
      );
    }
    console.log(`[Seed] Seeded ${questions.length} Level 1 questions.`);
  }

  // Seed Level 2 Case & Clues: "The Vanishing Prototype"
  const existingCases = db.prepare('SELECT COUNT(*) as count FROM level2_cases').get() as { count: number };
  if (existingCases.count === 0) {
    const caseId = uuidv4();
    const rubricJson = JSON.stringify({
      maxSuspect: 2,
      maxEvidence: 2,
      maxLogic: 1,
      maxTotal: 5,
      criteria: [
        "Suspect Identification (0-2 pts): Correctly identifies Kabir, Media Coordinator.",
        "Case Evidence (0-2 pts): Cites specific forensic evidence (looped video at 7:28, rear maintenance hatch, blue compound trace, workstation log/key ledger badge).",
        "Logical Explanation (0-1 pt): Coherently connects evidence to the conclusion and disproves suspect alibi."
      ]
    });

    const referenceAnswer =
      "Kabir, Media Coordinator took ORION. Kabir exported the demonstration video at 7:45 PM, but the video was a looped copy of the 7:28 PM recording (showing ORION in place). The media workstation logged in at 7:20 PM, looped the footage at 7:29 PM, and exported at 7:45 PM. The badge matches the 'K' on the service-key ledger. ORION was removed through the rear maintenance hatch behind the storage cabinet, which had no card reader and had its seal broken between 5:00 PM and 8:00 PM, with blue sealing compound matching the equipment cabinet.";

    const evaluationGuidance =
      "Award credit for: (1) Correct suspect: Kabir, Media Coordinator (2 pts). (2) Case-specific evidence: false looped video at 7:28 / corridor light unchanged at 7:46, rear maintenance hatch / blue compound trace, workstation login at 7:20 / looped at 7:29 / badge K on key ledger (up to 2 pts). (3) Logical reasoning connecting the evidence to Kabir (1 pt). Maximum 5 points.";

    db.prepare(`
      INSERT INTO level2_cases (
        id, title, situation_description, media_path, initial_credits, is_active, rubric_json,
        viewing_duration_seconds, replay_cost, reference_answer, evaluation_guidance,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 200, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      caseId,
      "The Vanishing Prototype",
      "At 8:00 PM on the night before the college’s annual innovation expo, a prototype called ORION disappeared from the locked Innovation Lab.\n\nORION is a compact AI device worth ₹10 lakh. It was last independently verified inside a sealed display case at 7:40 PM.\n\nAt 8:00 PM, the display case was empty. The laboratory door showed no signs of forced entry, the access log recorded no authorized entry after 7:30 PM, and the CCTV feed showed an apparently empty room.\n\nFour people had legitimate access to the lab that evening: Arjun (Project Lead), Meera (Hardware Engineer), Kabir (Media Coordinator), and Riya (Lab Assistant). Each tells a different story.",
      "/uploads/the_vanishing_prototype.jpg",
      rubricJson,
      60,
      20,
      referenceAnswer,
      evaluationGuidance,
      now,
      now
    );

    // Seed case media asset
    db.prepare(`
      INSERT INTO case_media (id, case_id, media_type, media_path, caption, display_order, created_at)
      VALUES (?, ?, 'image', ?, 'Crime Scene Overview - Innovation Lab', 1, ?)
    `).run(uuidv4(), caseId, '/uploads/the_vanishing_prototype.jpg', now);

    const clues = [
      // Question 1 Clues: Vault Keypad PIN (0728)
      {
        question_number: 1 as const,
        tier: 'simple' as const,
        title: "Keypad Smudges",
        content: "Smudges remember what hands forget. Four keys have been pressed more than the rest.",
        credit_cost: 50,
        display_order: 1
      },
      {
        question_number: 1 as const,
        tier: 'medium' as const,
        title: "Stated Times",
        content: "Strike out each stated time. Each one holds a digit that the worn keys do not.",
        credit_cost: 100,
        display_order: 2
      },
      {
        question_number: 1 as const,
        tier: 'high' as const,
        title: "Vault Timestamp",
        content: "The screen at 7:40 was not live—it showed a looped recording captured at 7:28 PM. The four-digit PIN uses those exact digits in 24-hour HHMM order.",
        credit_cost: 150,
        display_order: 3
      },
      // Question 2 Clues: Suspect Identification (Kabir, Media Coordinator)
      {
        question_number: 2 as const,
        tier: 'simple' as const,
        title: "The Silent Log",
        content: "A door log can stay silent while a screen tells the loudest lie. Follow the one who shapes what screens say.",
        credit_cost: 50,
        display_order: 1
      },
      {
        question_number: 2 as const,
        tier: 'medium' as const,
        title: "Timeline Verification",
        content: "An exit at 7:25, a lock at 7:30 and a workshop card from 7:32 to 8:05. Three evenings are accounted for. One is not.",
        credit_cost: 100,
        display_order: 2
      },
      {
        question_number: 2 as const,
        tier: 'high' as const,
        title: "Badge and Ledger",
        content: "The badge behind that account matches the ledger's letter, and the account belongs to the person who manages recordings.",
        credit_cost: 150,
        display_order: 3
      }
    ];

    const insertClue = db.prepare(`
      INSERT INTO clues (id, case_id, title, content, media_path, credit_cost, required_level, question_number, tier, display_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, ?, 1, ?, ?)
    `);

    for (const c of clues) {
      insertClue.run(uuidv4(), caseId, c.title, c.content, c.credit_cost, c.question_number, c.tier, c.display_order, now, now);
    }

    console.log(`[Seed] Seeded Level 2 Case "The Vanishing Prototype" with ${clues.length} clues.`);
  }

  console.log('[Seed] Database seeding completed successfully.');
}

// Allow direct CLI invocation
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed] Seeding failed:', err);
      process.exit(1);
    });
}
