const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class AuthManager {
  static JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  static JWT_EXPIRES_IN = '7d';
  static REFRESH_TOKEN_EXPIRES_IN = '30d';
  
  // Hash password
  static async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }
  
  // Verify password
  static async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }
  
  // Generate JWT token
  static generateToken(userId, email) {
    return jwt.sign(
      { userId, email },
      this.JWT_SECRET,
      { expiresIn: this.JWT_EXPIRES_IN }
    );
  }
  
  // Generate refresh token
  static generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
  }
  
  // Verify JWT token
  static verifyToken(token) {
    try {
      return jwt.verify(token, this.JWT_SECRET);
    } catch (error) {
      return null;
    }
  }
  
  // Generate random token for email verification / password reset
  static generateRandomToken() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = AuthManager;
