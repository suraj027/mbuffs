import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CertificationBadgeProps {
    certification: string | null | undefined;
    className?: string;
}

// Certification color mapping based on rating severity
const getCertificationColor = (cert: string): string => {
    const upperCert = cert.toUpperCase();
    
    // Movie ratings (MPAA)
    if (['G', 'TV-G', 'TV-Y', 'TV-Y7'].includes(upperCert)) {
        return 'bg-muted text-muted-foreground border-border';
    }
    if (['PG', 'TV-PG'].includes(upperCert)) {
        return 'bg-secondary text-secondary-foreground border-border';
    }
    if (['PG-13', 'TV-14'].includes(upperCert)) {
        return 'bg-accent text-accent-foreground border-border';
    }
    if (['R', 'TV-MA', 'NC-17', 'X', '18', '18+', 'A'].includes(upperCert)) {
        return 'bg-destructive/20 text-destructive border-destructive/40';
    }
    
    // International ratings
    if (['U', 'PG', '12', '12A', '15'].includes(upperCert)) {
        return 'bg-accent text-accent-foreground border-border';
    }
    
    // Default
    return 'bg-muted text-muted-foreground border-border';
};

export function CertificationBadge({ certification, className }: CertificationBadgeProps) {
    if (!certification) {
        return null;
    }

    const colorClass = getCertificationColor(certification);

    return (
        <Badge 
            variant="outline" 
            className={cn(
                'font-bold text-xs px-2 py-0.5 h-5',
                colorClass,
                className
            )}
        >
            {certification}
        </Badge>
    );
}

export default CertificationBadge;
