import { Router, Request, Response } from "express";
import User from "../models/User";
import Robot from "../models/Robot";
import jwt from "jsonwebtoken";
import { hashPassword, comparePassword } from "../utils/auth";
import { requireSignIn } from "../middlewares/auth";
import { genAPIKey } from "../utils/api";
import { google } from "googleapis";
import { capture } from "../utils/analytics";
export const router = Router();

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email) return res.status(400).send("Email is required");
    if (!password || password.length < 6)
      return res
        .status(400)
        .send("Password is required and must be at least 6 characters");

    let userExist = await User.findOne({ raw: true, where: { email } });
    if (userExist) return res.status(400).send("User already exists");

    const hashedPassword = await hashPassword(password);

    let user: any;

    try {
      user = await User.create({ email, password: hashedPassword });
    } catch (error: any) {
      console.log(`Could not create user - ${error}`);
      return res.status(500).send(`Could not create user - ${error.message}`);
    }

    if (!process.env.JWT_SECRET) {
      console.log("JWT_SECRET is not defined in the environment");
      return res.status(500).send("Internal Server Error");
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET as string);
    user.password = undefined as unknown as string;
    res.cookie("token", token, {
      httpOnly: true,
    });
    capture("maxun-oss-user-registered", {
      email: user.email,
      userId: user.id,
      registeredAt: new Date().toISOString(),
    });
    console.log(`User registered - ${user.email}`);
    res.json(user);
  } catch (error: any) {
    console.log(`Could not register user - ${error}`);
    res.status(500).send(`Could not register user - ${error.message}`);
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).send("Email and password are required");
    if (password.length < 6)
      return res.status(400).send("Password must be at least 6 characters");

    let user = await User.findOne({ raw: true, where: { email } });
    if (!user) return res.status(400).send("User does not exist");

    const match = await comparePassword(password, user.password);
    if (!match) return res.status(400).send("Invalid email or password");

    const token = jwt.sign({ id: user?.id }, process.env.JWT_SECRET as string);

    // return user and token to client, exclude hashed password
    if (user) {
      user.password = undefined as unknown as string;
    }
    res.cookie("token", token, {
      httpOnly: true,
    });
    capture("maxun-oss-user-login", {
      email: user.email,
      userId: user.id,
      loggedInAt: new Date().toISOString(),
    });
    res.json(user);
  } catch (error: any) {
    res.status(400).send(`Could not login user - ${error.message}`);
    console.log(`Could not login user - ${error}`);
  }
});

router.get("/logout", async (req, res) => {
  try {
    res.clearCookie("token");
    return res.json({ message: "Logout successful" });
  } catch (error: any) {
    res.status(500).send(`Could not logout user - ${error.message}`);
  }
});

router.get(
  "/current-user",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
      });
      if (!user) {
        return res.status(404).json({ ok: false, error: "User not found" });
      } else {
        return res.status(200).json({ ok: true, user: user });
      }
    } catch (error: any) {
      console.error("Error in current-user route:", error);
      return res
        .status(500)
        .json({
          ok: false,
          error: `Could not fetch current user: ${error.message}`,
        });
    }
  }
);

router.get(
  "/user/:id",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const user = await User.findByPk(id, {
        attributes: { exclude: ["password"] },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      return res
        .status(200)
        .json({ message: "User fetched successfully", user });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching user", error: error.message });
    }
  }
);

router.post(
  "/generate-api-key",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.api_key) {
        return res.status(400).json({ message: "API key already exists" });
      }
      const apiKey = genAPIKey();

      await user.update({ api_key: apiKey });

      capture("maxun-oss-api-key-created", {
        user_id: user.id,
        created_at: new Date().toISOString(),
      });

      return res.status(200).json({
        message: "API key generated successfully",
        api_key: apiKey,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Error generating API key", error });
    }
  }
);

router.get(
  "/api-key",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const user = await User.findByPk(req.user.id, {
        raw: true,
        attributes: ["api_key"],
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.status(200).json({
        message: "API key fetched successfully",
        api_key: user.api_key || null,
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching API key", error });
    }
  }
);

router.delete(
  "/delete-api-key",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).send({ error: "Unauthorized" });
    }

    try {
      const user = await User.findByPk(req.user.id, { raw: true });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!user.api_key) {
        return res.status(404).json({ message: "API Key not found" });
      }

      await User.update({ api_key: null }, { where: { id: req.user.id } });

      capture("maxun-oss-api-key-deleted", {
        user_id: user.id,
        deleted_at: new Date().toISOString(),
      });

      return res.status(200).json({ message: "API Key deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting API key", error: error.message });
    }
  }
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Step 1: Redirect to Google for authentication
router.get("/google", (req, res) => {
  const { robotId } = req.query;
  if (!robotId) {
    return res.status(400).json({ message: "Robot ID is required" });
  }
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.readonly",
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Ensures you get a refresh token on first login
    scope: scopes,
    state: robotId.toString(),
  });
  res.redirect(url);
});

// Step 2: Handle Google OAuth callback
router.get(
  "/google/callback",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    const { code, state } = req.query;
    try {
      if (!state) {
        return res.status(400).json({ message: "Robot ID is required" });
      }

      const robotId = state;

      // Get access and refresh tokens
      if (typeof code !== "string") {
        return res.status(400).json({ message: "Invalid code" });
      }
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user profile from Google
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const {
        data: { email },
      } = await oauth2.userinfo.get();

      if (!email) {
        return res.status(400).json({ message: "Email not found" });
      }

      if (!req.user) {
        return res.status(401).send({ error: "Unauthorized" });
      }

      // Get the currently authenticated user (from `requireSignIn`)
      let user = await User.findOne({ where: { id: req.user.id } });

      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }

      let robot = await Robot.findOne({
        where: { "recording_meta.id": robotId },
      });

      if (!robot) {
        return res.status(400).json({ message: "Robot not found" });
      }

      robot = await robot.update({
        google_sheet_email: email,
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token,
      });
      capture("maxun-oss-google-sheet-integration-created", {
        user_id: user.id,
        robot_id: robot.recording_meta.id,
        created_at: new Date().toISOString(),
      });

      // List user's Google Sheets from their Google Drive
      const drive = google.drive({ version: "v3", auth: oauth2Client });
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet'", // List only Google Sheets files
        fields: "files(id, name)", // Retrieve the ID and name of each file
      });

      const files = response.data.files || [];
      if (files.length === 0) {
        return res.status(404).json({ message: "No spreadsheets found." });
      }

      // Generate JWT token for session
      const jwtToken = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET as string
      );
      res.cookie("token", jwtToken, { httpOnly: true });

      // res.json({
      //     message: 'Google authentication successful',
      //     google_sheet_email: robot.google_sheet_email,
      //     jwtToken,
      //     files
      // });

      res.cookie("robot_auth_status", "success", {
        httpOnly: false,
        maxAge: 60000,
      }); // 1-minute expiration
      res.cookie("robot_auth_message", "Robot successfully authenticated", {
        httpOnly: false,
        maxAge: 60000,
      });
      res.redirect(process.env.PUBLIC_URL as string || "http://localhost:5173");
    } catch (error: any) {
      res.status(500).json({ message: `Google OAuth error: ${error.message}` });
    }
  }
);

// Step 3: Get data from Google Sheets
router.post(
  "/gsheets/data",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    const { spreadsheetId, robotId } = req.body;
    if (!req.user) {
      return res.status(401).send({ error: "Unauthorized" });
    }
    const user = await User.findByPk(req.user.id, { raw: true });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const robot = await Robot.findOne({
      where: { "recording_meta.id": robotId },
      raw: true,
    });

    if (!robot) {
      return res.status(400).json({ message: "Robot not found" });
    }

    // Set Google OAuth credentials
    oauth2Client.setCredentials({
      access_token: robot.google_access_token,
      refresh_token: robot.google_refresh_token,
    });

    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    try {
      // Fetch data from the spreadsheet (you can let the user choose a specific range too)
      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Sheet1!A1:D5", // Default range, could be dynamic based on user input
      });
      res.json(sheetData.data);
    } catch (error: any) {
      res
        .status(500)
        .json({ message: `Error accessing Google Sheets: ${error.message}` });
    }
  }
);

// Step 4: Get user's Google Sheets files (new route)
router.get("/gsheets/files", requireSignIn, async (req, res) => {
  try {
    const robotId = req.query.robotId;
    const robot = await Robot.findOne({
      where: { "recording_meta.id": robotId },
      raw: true,
    });

    if (!robot) {
      return res.status(400).json({ message: "Robot not found" });
    }

    oauth2Client.setCredentials({
      access_token: robot.google_access_token,
      refresh_token: robot.google_refresh_token,
    });

    // List user's Google Sheets files from their Google Drive
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet'",
      fields: "files(id, name)",
    });

    const files = response.data.files || [];
    if (files.length === 0) {
      return res.status(404).json({ message: "No spreadsheets found." });
    }

    res.json(files);
  } catch (error: any) {
    console.log("Error fetching Google Sheets files:", error);
    res
      .status(500)
      .json({
        message: `Error retrieving Google Sheets files: ${error.message}`,
      });
  }
});

// Step 5: Update robot's google_sheet_id when a Google Sheet is selected
router.post("/gsheets/update", requireSignIn, async (req, res) => {
  const { spreadsheetId, spreadsheetName, robotId } = req.body;

  if (!spreadsheetId || !robotId) {
    return res
      .status(400)
      .json({ message: "Spreadsheet ID and Robot ID are required" });
  }

  try {
    let robot = await Robot.findOne({
      where: { "recording_meta.id": robotId },
    });

    if (!robot) {
      return res.status(404).json({ message: "Robot not found" });
    }

    await robot.update({
      google_sheet_id: spreadsheetId,
      google_sheet_name: spreadsheetName,
    });

    res.json({ message: "Robot updated with selected Google Sheet ID" });
  } catch (error: any) {
    res.status(500).json({ message: `Error updating robot: ${error.message}` });
  }
});

router.post(
  "/gsheets/remove",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    const { robotId } = req.body;
    if (!robotId) {
      return res.status(400).json({ message: "Robot ID is required" });
    }

    if (!req.user) {
      return res.status(401).send({ error: "Unauthorized" });
    }

    try {
      let robot = await Robot.findOne({
        where: { "recording_meta.id": robotId },
      });

      if (!robot) {
        return res.status(404).json({ message: "Robot not found" });
      }

      await robot.update({
        google_sheet_id: null,
        google_sheet_name: null,
        google_sheet_email: null,
        google_access_token: null,
        google_refresh_token: null,
      });

      capture("maxun-oss-google-sheet-integration-removed", {
        user_id: req.user.id,
        robot_id: robotId,
        deleted_at: new Date().toISOString(),
      });

      res.json({ message: "Google Sheets integration removed successfully" });
    } catch (error: any) {
      res
        .status(500)
        .json({
          message: `Error removing Google Sheets integration: ${error.message}`,
        });
    }
  }
);
