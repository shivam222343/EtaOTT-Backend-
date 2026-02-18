export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.dbUser) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        if (!allowedRoles.includes(req.dbUser.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Required role: ${allowedRoles.join(' or ')}`
            });
        }

        next();
    };
}

export const requireStudent = requireRole('student');
export const requireFaculty = requireRole('faculty');
export const requireAdmin = requireRole('admin');
export const requireFacultyOrAdmin = requireRole('faculty', 'admin');
