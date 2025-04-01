import { Response } from "express";
import User from "../models/User";
import { AuthenticatedRequest } from "../routes/record"

export const requireAPIKey = async (req: AuthenticatedRequest, res: Response, next: any) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: "API key is missing" });
    }
    const user = await User.findOne({ where: { api_key: apiKey } });
    if (!user) {
        return res.status(403).json({ error: "Invalid API key" });
    }
    req.user = user;  
    next();  
};
