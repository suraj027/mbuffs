import { useState } from 'react';
import { cn } from '@/lib/utils';
import { SeverityLevel } from '@/lib/types';
import { 
    AlertTriangle, 
    Skull, 
    MessageSquareWarning, 
    Wine, 
    Ghost,
    Info
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';

interface ParentalGuidanceData {
    nudity: SeverityLevel | null;
    violence: SeverityLevel | null;
    profanity: SeverityLevel | null;
    alcohol: SeverityLevel | null;
    frightening: SeverityLevel | null;
}

interface ParentalGuidanceProps {
    data: ParentalGuidanceData | null;
    isLoading?: boolean;
    className?: string;
}

// Severity colors and styles
const severityConfig: Record<SeverityLevel, { bg: string; text: string; border: string; label: string }> = {
    none: { 
        bg: 'bg-emerald-500/10', 
        text: 'text-emerald-400', 
        border: 'border-emerald-500/30',
        label: 'None'
    },
    mild: { 
        bg: 'bg-amber-500/10', 
        text: 'text-amber-400', 
        border: 'border-amber-500/30',
        label: 'Mild'
    },
    moderate: { 
        bg: 'bg-orange-500/10', 
        text: 'text-orange-400', 
        border: 'border-orange-500/30',
        label: 'Moderate'
    },
    severe: { 
        bg: 'bg-red-500/10', 
        text: 'text-red-400', 
        border: 'border-red-500/30',
        label: 'Severe'
    },
};

// Category badge - pill style matching the reference image
function CategoryBadge({ label, severity }: { label: string; severity: SeverityLevel }) {
    const config = severityConfig[severity];
    return (
        <div className={cn(
            'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
            'border',
            config.bg,
            config.text,
            config.border,
        )}>
            {label}
        </div>
    );
}

// Category item for modal detail view
interface CategoryItemProps {
    icon: React.ReactNode;
    label: string;
    severity: SeverityLevel;
    iconColor: string;
}

function CategoryItem({ icon, label, severity, iconColor }: CategoryItemProps) {
    const config = severityConfig[severity];
    
    return (
        <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-lg shrink-0',
                    'bg-muted/50'
                )}>
                    <span className={iconColor}>{icon}</span>
                </div>
                <span className="text-sm text-foreground/90">{label}</span>
            </div>
            <div className={cn(
                'px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide shrink-0',
                config.bg,
                config.text
            )}>
                {config.label}
            </div>
        </div>
    );
}

export function ParentalGuidance({ data, isLoading, className }: ParentalGuidanceProps) {
    const [isOpen, setIsOpen] = useState(false);

    if (isLoading) {
        return (
            <div className={cn("flex flex-wrap justify-center md:justify-start gap-2", className)}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-9 w-28 bg-muted/60 rounded-full animate-pulse" />
                ))}
            </div>
        );
    }

    if (!data) {
        return null;
    }

    // Check if all values are null (no data available)
    const hasData = data.nudity || data.violence || data.profanity || data.alcohol || data.frightening;
    
    if (!hasData) {
        return null;
    }

    const categories = [
        { 
            icon: <AlertTriangle className="w-4 h-4" />, 
            label: 'Sex & Nudity', 
            severity: data.nudity,
            iconColor: 'text-rose-400'
        },
        { 
            icon: <Skull className="w-4 h-4" />, 
            label: 'Violence & Gore', 
            severity: data.violence,
            iconColor: 'text-red-400'
        },
        { 
            icon: <MessageSquareWarning className="w-4 h-4" />, 
            label: 'Profanity', 
            severity: data.profanity,
            iconColor: 'text-amber-400'
        },
        { 
            icon: <Wine className="w-4 h-4" />, 
            label: 'Alcohol & Drugs', 
            severity: data.alcohol,
            iconColor: 'text-purple-400'
        },
        { 
            icon: <Ghost className="w-4 h-4" />, 
            label: 'Frightening Scenes', 
            severity: data.frightening,
            iconColor: 'text-sky-400'
        },
    ].filter(cat => cat.severity !== null) as Array<{
        icon: React.ReactNode;
        label: string;
        severity: SeverityLevel;
        iconColor: string;
    }>;

    // Filter to show severe and moderate categories in badges
    // If none exist, fall back to showing mild categories
    const severeOrModerate = categories.filter(
        cat => cat.severity === 'severe' || cat.severity === 'moderate'
    );
    const highlightedCategories = severeOrModerate.length > 0 
        ? severeOrModerate 
        : categories.filter(cat => cat.severity === 'mild');

    return (
        <div className={cn("flex flex-wrap justify-center md:justify-start items-center gap-2", className)}>
            {/* Category badges - only severe and moderate */}
            {highlightedCategories.map((cat, idx) => (
                <CategoryBadge 
                    key={idx} 
                    label={cat.label} 
                    severity={cat.severity}
                />
            ))}
            
            {/* Info button with modal */}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                    <button 
                        className={cn(
                            "flex items-center justify-center w-7 h-7 rounded-full",
                            "border border-border text-muted-foreground",
                            "hover:bg-accent hover:text-accent-foreground hover:border-border",
                            "transition-colors"
                        )}
                        aria-label="View parental guidance details"
                    >
                        <Info className="w-3.5 h-3.5" />
                    </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Parental Guide</DialogTitle>
                    </DialogHeader>
                    <div className="divide-y divide-border">
                        {categories.map((cat, index) => (
                            <CategoryItem
                                key={index}
                                icon={cat.icon}
                                label={cat.label}
                                severity={cat.severity}
                                iconColor={cat.iconColor}
                            />
                        ))}
                    </div>
                    {/* Attribution */}
                    <div className="mt-2 pt-3 border-t border-border flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                            Content advisory ratings
                        </span>
                        <span className="text-xs text-muted-foreground">
                            Source: IMDB
                        </span>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default ParentalGuidance;
