import React, { useState, useEffect, useMemo, FormEvent, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';


// --- INTERFACES ---
interface Deployment {
  id: string;
  location: string;
  startTime: string;
  endTime: string;
}

interface Entry {
  id: string;
  date: string; // YYYY-MM-DD
  location: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  isChildSick?: boolean;
  deployments?: Deployment[];
}

interface SummaryMetrics {
  totalOvertime: number;
  currentMonthOvertime: number;
  totalWorkHours: number;
  vacationDays: number;
  sickDays: number;
  onCallDays: number;
}

type ShareState = 'idle' | 'preparing' | 'ready' | 'error';


// --- UTILITY FUNCTIONS ---
const calculateHours = (start: string, end: string): number => {
  if (!start || !end) return 0;
  const startTime = new Date(`1970-01-01T${start}:00`);
  const endTime = new Date(`1970-01-01T${end}:00`);
  if (endTime <= startTime) return 0;
  const diff = endTime.getTime() - startTime.getTime();
  const hours = diff / (1000 * 60 * 60);
  return Math.max(0, hours);
};

const formatHours = (hours: number): string => {
    const roundedHours = Math.round(hours * 100) / 100;
    
    // Format to German locale string which uses a comma for the decimal point
    const formattedNumber = new Intl.NumberFormat('de-DE', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2,
    }).format(Math.abs(roundedHours));

    const sign = roundedHours < 0 ? "-" : "+";
    return `${sign} ${formattedNumber}`;
};

const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('de-DE', {
        weekday: 'short',
        year: '2-digit',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

const transformTimeShorthand = (time: string): string => {
    if (!time || !time.includes(':')) return time;

    let [hours, minutes] = time.split(':');
    
    if (minutes.length === 1) {
        switch (minutes) {
            case '1': minutes = '15'; break;
            case '3': minutes = '30'; break;
            case '4': minutes = '45'; break;
            case '0': minutes = '00'; break;
            default: break; 
        }
    }
    
    const formattedHours = hours.padStart(2, '0');
    const formattedMinutes = minutes.padStart(2, '0');
    
    return `${formattedHours}:${formattedMinutes}`;
};

// --- CONFIRM MODAL COMPONENT ---
interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'danger' | 'primary';
}

const ConfirmModal = ({ title, message, onConfirm, onCancel, confirmText = 'Bestätigen', cancelText = 'Abbrechen', confirmVariant = 'primary' }: ConfirmModalProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);
  
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="close-button" onClick={onCancel} aria-label="Schließen">&times;</button>
        </div>
        <div className="modal-body">
          <p>{message}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="cancel-button" onClick={onCancel}>{cancelText}</button>
          <button type="button" className={`submit-button ${confirmVariant === 'danger' ? 'danger' : ''}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};


// --- EDIT MODAL COMPONENT ---
interface EditModalProps {
  entry: Entry;
  onUpdate: (updatedEntry: Entry) => void;
  onCancel: () => void;
  savedLocations: string[];
}

const EditModal = ({ entry, onUpdate, onCancel, savedLocations }: EditModalProps) => {
  const [formData, setFormData] = useState({
    ...entry,
    hasDeployments: !!entry.deployments && entry.deployments.length > 0,
    deployments: entry.deployments || [],
  });
  const [currentDeployment, setCurrentDeployment] = useState({ location: '', startTime: '', endTime: '' });
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (value) {
      setFormData(prev => ({ ...prev, [name]: transformTimeShorthand(value) }));
    }
  };

  const handleDeploymentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentDeployment(prev => ({ ...prev, [name]: value }));
  };
  
  const handleDeploymentTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (value) {
      setCurrentDeployment(prev => ({ ...prev, [name]: transformTimeShorthand(value) }));
    }
  };


  const handleAddDeployment = () => {
    const { location, startTime, endTime } = currentDeployment;
    if (!location || !startTime || !endTime || calculateHours(startTime, endTime) <= 0) {
        setError("Bitte für den Einsatz Ort, gültige Start- und Endzeit angeben.");
        return;
    }
    setError(null);
    setFormData(prev => ({
        ...prev,
        deployments: [...prev.deployments, { id: Date.now().toString(), ...currentDeployment }]
    }));
    setCurrentDeployment({ location: '', startTime: '', endTime: '' });
  };

  const handleRemoveDeployment = (id: string) => {
    setFormData(prev => ({
        ...prev,
        deployments: prev.deployments.filter(d => d.id !== id)
    }));
  };

  const locationLower = formData.location.trim().toLowerCase();
  const isSpecialEntry = locationLower === 'urlaub' || locationLower === 'krank' || locationLower === 'bereitschaft';

  const handleSaveChanges = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const { date, location, startTime, endTime, isChildSick, hasDeployments, deployments, id } = formData;

    if (!date || !location) {
      setError("Datum und Ort/Auftrag sind Pflichtfelder.");
      return;
    }
    
    if (!isSpecialEntry && (!startTime || !endTime || calculateHours(startTime, endTime) <= 0)) {
        setError("Bei regulären Einträgen sind eine gültige Start- und Endzeit erforderlich, die eine positive Arbeitszeit ergeben.");
        return;
    }

    const updatedEntry: Entry = {
      id,
      date,
      location,
      startTime: isSpecialEntry ? '' : startTime,
      endTime: isSpecialEntry ? '' : endTime,
      isChildSick: locationLower === 'krank' ? isChildSick : undefined,
      deployments: locationLower === 'bereitschaft' && hasDeployments ? deployments : undefined,
    };

    onUpdate(updatedEntry);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            <datalist id="edit-saved-locations-list">
                {savedLocations.map(loc => <option key={loc} value={loc} />)}
            </datalist>
            <form onSubmit={handleSaveChanges} noValidate>
                <div className="modal-header">
                    <h2>Eintrag bearbeiten</h2>
                    <button type="button" className="close-button" onClick={onCancel} aria-label="Schließen">&times;</button>
                </div>
                <div className="modal-body">
                    <div className="entry-form">
                         <div className="form-group">
                            <label htmlFor="edit-date">Datum</label>
                            <input type="date" id="edit-date" name="date" value={formData.date} onChange={handleInputChange} required />
                        </div>
                        <div className="form-group">
                            <label htmlFor="edit-location">Ort / Auftrag</label>
                            <input type="text" id="edit-location" name="location" value={formData.location} onChange={handleInputChange} placeholder="z.B. Büro, Urlaub, Krank, Bereitschaft" list="edit-saved-locations-list" required />
                        </div>

                        {locationLower === 'krank' && (
                            <div className="form-group checkbox-group">
                                <input type="checkbox" id="edit-isChildSick" name="isChildSick" checked={!!formData.isChildSick} onChange={handleInputChange}/>
                                <label htmlFor="edit-isChildSick">Auf Kind krank</label>
                            </div>
                        )}
                        
                        {locationLower === 'bereitschaft' && (
                            <div className="form-group checkbox-group">
                                <input type="checkbox" id="edit-hasDeployments" name="hasDeployments" checked={formData.hasDeployments} onChange={handleInputChange}/>
                                <label htmlFor="edit-hasDeployments">Einsätze vorhanden?</label>
                            </div>
                        )}

                        <div className="time-input-group">
                            <div className="form-group">
                                <label htmlFor="edit-startTime">Von</label>
                                <input type="time" id="edit-startTime" name="startTime" value={formData.startTime} onChange={handleInputChange} onBlur={handleTimeBlur} disabled={isSpecialEntry} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-endTime">Bis</label>
                                <input type="time" id="edit-endTime" name="endTime" value={formData.endTime} onChange={handleInputChange} onBlur={handleTimeBlur} disabled={isSpecialEntry} />
                            </div>
                        </div>

                        {locationLower === 'bereitschaft' && formData.hasDeployments && (
                            <div className="deployment-form-section">
                                <h3>Einsätze</h3>
                                <div className="deployment-inputs">
                                    <div className="form-group">
                                        <label htmlFor="edit-dep-location">Einsatzort</label>
                                        <input type="text" id="edit-dep-location" name="location" value={currentDeployment.location} onChange={handleDeploymentChange} placeholder="Ort des Einsatzes" list="edit-saved-locations-list" />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="edit-dep-startTime">Von</label>
                                        <input type="time" id="edit-dep-startTime" name="startTime" value={currentDeployment.startTime} onChange={handleDeploymentChange} onBlur={handleDeploymentTimeBlur} />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="edit-dep-endTime">Bis</label>
                                        <input type="time" id="edit-dep-endTime" name="endTime" value={currentDeployment.endTime} onChange={handleDeploymentChange} onBlur={handleDeploymentTimeBlur} />
                                    </div>
                                    <button type="button" className="add-deployment-button" onClick={handleAddDeployment}>+</button>
                                </div>
                                {formData.deployments.length > 0 && (
                                    <ul className="new-deployment-list">
                                        {formData.deployments.map(dep => (
                                            <li key={dep.id}>
                                                <span>{dep.location} ({dep.startTime} - {dep.endTime})</span>
                                                <button type="button" onClick={() => handleRemoveDeployment(dep.id)}>🗑️</button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                     {error && <p className="error-message" style={{gridColumn: '1 / -1'}}>{error}</p>}
                </div>
                <div className="modal-actions">
                    <button type="button" className="cancel-button" onClick={onCancel}>Abbrechen</button>
                    <button type="submit" className="submit-button">Speichern</button>
                </div>
            </form>
        </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
const App = () => {
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      const savedEntries = localStorage.getItem('timesheetEntries');
      return savedEntries ? JSON.parse(savedEntries) : [];
    } catch (error) {
      console.error("Error reading from localStorage", error);
      return [];
    }
  });

  const [employeeName, setEmployeeName] = useState<string>(() => {
    try {
      return localStorage.getItem('employeeName') || '';
    } catch (error) {
      console.error("Error reading employee name from localStorage", error);
      return '';
    }
  });
  
  const [baseOvertime, setBaseOvertime] = useState<number>(() => {
    try {
        const saved = localStorage.getItem('baseOvertime');
        return saved ? parseFloat(saved) : 0;
    } catch (error) {
        console.error("Error reading base overtime from localStorage", error);
        return 0;
    }
  });

  const [savedLocations, setSavedLocations] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('savedLocations');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("Error reading saved locations from localStorage", error);
      return [];
    }
  });
  
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [confirmation, setConfirmation] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText: string;
    confirmVariant: 'danger' | 'primary';
  } | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [shareState, setShareState] = useState<ShareState>('idle');
  const [shareFiles, setShareFiles] = useState<{ pdf: File, json: File } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const locationInputRef = useRef<HTMLInputElement>(null);

  const [saveIndicatorText, setSaveIndicatorText] = useState<string>('Alle Änderungen werden automatisch gespeichert.');
  const [resetMessage, setResetMessage] = useState<string>('');

  const [reportDate, setReportDate] = useState(new Date());

  const initialNewEntryState = {
    date: new Date().toISOString().split('T')[0],
    location: '',
    startTime: '',
    endTime: '',
    isChildSick: false,
    hasDeployments: false,
    deployments: [],
  };

  const [newEntry, setNewEntry] = useState<{
    date: string;
    location: string;
    startTime: string;
    endTime: string;
    isChildSick: boolean;
    hasDeployments: boolean;
    deployments: Deployment[];
  }>(initialNewEntryState);
  
  const [currentDeployment, setCurrentDeployment] = useState({
    location: '',
    startTime: '',
    endTime: '',
  });

  const [newSavedLocation, setNewSavedLocation] = useState('');
  const [copiedLocation, setCopiedLocation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
    }

    try {
      localStorage.setItem('timesheetEntries', JSON.stringify(entries));
      localStorage.setItem('employeeName', employeeName);
      localStorage.setItem('savedLocations', JSON.stringify(savedLocations));
      localStorage.setItem('baseOvertime', baseOvertime.toString());
      setSaveIndicatorText('Gespeichert!');
      const timer = setTimeout(() => setSaveIndicatorText('Alle Änderungen werden automatisch gespeichert.'), 2000);
      return () => clearTimeout(timer); // Cleanup timer on unmount or re-run
    } catch (error) {
      console.error("Error writing to localStorage", error);
      setSaveIndicatorText('Speicherfehler!');
    }
  }, [entries, employeeName, savedLocations, baseOvertime]);

   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
        const aIsBereitschaft = a.location.trim().toLowerCase() === 'bereitschaft';
        const bIsBereitschaft = b.location.trim().toLowerCase() === 'bereitschaft';

        if (aIsBereitschaft && !bIsBereitschaft) {
            return 1; // a comes after b
        }
        if (!aIsBereitschaft && bIsBereitschaft) {
            return -1; // a comes before b
        }
        
        // If both are Bereitschaft or both are not, sort by date and time
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) {
            return dateA - dateB;
        }
        
        if (a.startTime && b.startTime) {
            return a.startTime.localeCompare(b.startTime);
        }
        return 0;
    });
  }, [entries]);

  const summaryMetrics: SummaryMetrics = useMemo(() => {
    const vacationDays = new Set<string>();
    const sickDays = new Set<string>();
    const onCallDays = new Set<string>();
    const workHoursByDay: Map<string, number> = new Map();
    const deploymentHoursByDay: Map<string, number> = new Map();

    // First, identify all vacation and sick days. These take precedence.
    entries.forEach(entry => {
        const location = entry.location.trim().toLowerCase();
        if (location === 'urlaub') {
            vacationDays.add(entry.date);
        } else if (location === 'krank') {
            // This correctly captures all 'krank' entries, including when 'isChildSick' is true.
            sickDays.add(entry.date);
        }
    });

    // Now, process hours for all entries, but ignore days that are vacation or sick.
    entries.forEach(entry => {
        if (vacationDays.has(entry.date) || sickDays.has(entry.date)) {
            return; // Skip this entry entirely for hour calculation
        }

        const location = entry.location.trim().toLowerCase();
        
        if (location === 'bereitschaft') {
            onCallDays.add(entry.date);
            if (entry.deployments) {
                entry.deployments.forEach(dep => {
                    const depHours = calculateHours(dep.startTime, dep.endTime);
                    const currentHours = deploymentHoursByDay.get(entry.date) || 0;
                    deploymentHoursByDay.set(entry.date, currentHours + depHours);
                });
            }
        } else if (location !== 'pause') { // Regular work entry
            const calculated = calculateHours(entry.startTime, entry.endTime);
            if(calculated > 0) {
              const currentHours = workHoursByDay.get(entry.date) || 0;
              workHoursByDay.set(entry.date, currentHours + calculated);
            }
        }
    });

    // Calculate metrics
    let calculatedOvertime = 0;
    let currentMonthOvertime = 0;
    let totalWorkHours = 0;
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;

    for (const [date, hours] of workHoursByDay.entries()) {
        const dailyOvertime = hours - 8;
        calculatedOvertime += dailyOvertime;
        totalWorkHours += hours;
        if (date.startsWith(currentMonthStr)) {
            currentMonthOvertime += dailyOvertime;
        }
    }
    
    for (const [date, hours] of deploymentHoursByDay.entries()) {
        calculatedOvertime += hours; // Deployments are pure overtime
        totalWorkHours += hours;
        if (date.startsWith(currentMonthStr)) {
            currentMonthOvertime += hours;
        }
    }

    return {
        totalOvertime: calculatedOvertime + baseOvertime,
        currentMonthOvertime,
        totalWorkHours,
        vacationDays: vacationDays.size,
        sickDays: sickDays.size,
        onCallDays: onCallDays.size,
    };
}, [entries, baseOvertime]);


  const currentMonthYear = useMemo(() => {
    return new Intl.DateTimeFormat('de-DE', {
        month: 'long',
        year: 'numeric'
    }).format(reportDate);
  }, [reportDate]);

  const monthNames = useMemo(() => ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"], []);
  const yearRange = useMemo(() => {
      const currentYear = new Date().getFullYear();
      return Array.from({ length: 11 }, (_, i) => currentYear - 5 + i); // 5 years back, current, 5 years forward
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setNewEntry(prev => ({ 
        ...prev, 
        [name]: type === 'checkbox' ? checked : value 
    }));
  };
  
  const handleNewEntryTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (value) {
        const transformedTime = transformTimeShorthand(value);
        setNewEntry(prev => ({ ...prev, [name]: transformedTime }));
    }
  };
  
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmployeeName(e.target.value);
  };
  
  const handleBaseOvertimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setBaseOvertime(value === '' ? 0 : parseFloat(value));
  };


  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMonth = parseInt(e.target.value, 10);
    setReportDate(prevDate => {
        const newDate = new Date(prevDate);
        newDate.setDate(1); // Avoid issues with different month lengths
        newDate.setMonth(newMonth);
        return newDate;
    });
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newYear = parseInt(e.target.value, 10);
      setReportDate(prevDate => {
          const newDate = new Date(prevDate);
          newDate.setFullYear(newYear);
          return newDate;
      });
  };

  const handleDeploymentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentDeployment(prev => ({ ...prev, [name]: value }));
  };
  
  const handleNewDeploymentTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (value) {
        const transformedTime = transformTimeShorthand(value);
        setCurrentDeployment(prev => ({ ...prev, [name]: transformedTime }));
    }
  };

  const handleAddDeployment = () => {
    const { location, startTime, endTime } = currentDeployment;
    if (!location || !startTime || !endTime || calculateHours(startTime, endTime) <= 0) {
        setError("Bitte für den Einsatz Ort, gültige Start- und Endzeit angeben.");
        return;
    }
    setError(null);
    setNewEntry(prev => ({
        ...prev,
        deployments: [...prev.deployments, { id: Date.now().toString(), ...currentDeployment }]
    }));
    setCurrentDeployment({ location: '', startTime: '', endTime: '' });
  };
  
  const handleRemoveNewDeployment = (id: string) => {
    setNewEntry(prev => ({
        ...prev,
        deployments: prev.deployments.filter(d => d.id !== id)
    }));
  };

  const locationLower = newEntry.location.trim().toLowerCase();
  const isSpecialEntry = locationLower === 'urlaub' || locationLower === 'krank' || locationLower === 'bereitschaft';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const { date, location, startTime, endTime, isChildSick, hasDeployments, deployments } = newEntry;

    if (!date || !location) {
      setError("Datum und Ort/Auftrag sind Pflichtfelder.");
      return;
    }

    if (!isSpecialEntry && (!startTime || !endTime || calculateHours(startTime, endTime) <= 0)) {
        setError("Bei regulären Einträgen sind eine gültige Start- und Endzeit erforderlich, die eine positive Arbeitszeit ergeben.");
        return;
    }

    const newEntryToAdd: Entry = {
      id: Date.now().toString(),
      date,
      location,
      startTime: isSpecialEntry ? '' : startTime,
      endTime: isSpecialEntry ? '' : endTime,
      isChildSick: locationLower === 'krank' ? isChildSick : undefined,
      deployments: locationLower === 'bereitschaft' && hasDeployments ? deployments : undefined,
    };

    setEntries(prev => [newEntryToAdd, ...prev]);
    
    // Reset the form for the next entry, but keep the date
    setNewEntry(prev => ({
        ...initialNewEntryState,
        date: prev.date,
    }));
    // Also reset the deployment form fields
    setCurrentDeployment({ location: '', startTime: '', endTime: '' });
  };
  
  const handleAddPause = useCallback(() => {
    const lastWorkEntry = [...sortedEntries].reverse().find(e => {
        const loc = e.location.trim().toLowerCase();
        return loc !== 'urlaub' && loc !== 'krank' && loc !== 'bereitschaft' && loc !== 'pause' && e.endTime;
    });

    if (!lastWorkEntry) {
        alert("Fügen Sie zuerst einen regulären Arbeitseintrag hinzu, um eine Pause anzuhängen.");
        return;
    }

    const pauseStartTime = lastWorkEntry.endTime;
    const startTimeDate = new Date(`1970-01-01T${pauseStartTime}:00`);
    
    startTimeDate.setMinutes(startTimeDate.getMinutes() + 30);
    
    const pauseEndTime = startTimeDate.toTimeString().substring(0, 5);

    const pauseEntry: Entry = {
        id: Date.now().toString(),
        date: lastWorkEntry.date,
        location: 'Pause',
        startTime: pauseStartTime,
        endTime: pauseEndTime,
    };

    setEntries(prev => [...prev, pauseEntry]);
  }, [sortedEntries]);

  const handleAddStandardDay = useCallback(() => {
    setNewEntry(prev => ({
      ...prev,
      location: 'Büro',
      startTime: '07:00',
      endTime: '15:30',
      isChildSick: false,
      hasDeployments: false,
      deployments: []
    }));
  }, []);

  const handleAddFriday = useCallback(() => {
    setNewEntry(prev => ({
      ...prev,
      location: 'Büro',
      startTime: '07:00',
      endTime: '13:00',
      isChildSick: false,
      hasDeployments: false,
      deployments: []
    }));
  }, []);

  const handleUpdateEntry = useCallback((updatedEntry: Entry) => {
    setEntries(prev => prev.map(e => (e.id === updatedEntry.id ? updatedEntry : e)));
    setEditingEntry(null);
  }, []);
  
  const handleDeleteEntry = (id: string) => {
    setConfirmation({
        isOpen: true,
        title: 'Eintrag löschen',
        message: 'Möchten Sie diesen Eintrag wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
        onConfirm: () => {
            setEntries(prev => prev.filter(e => e.id !== id));
            setConfirmation(null);
        },
        onCancel: () => setConfirmation(null),
        confirmText: 'Löschen',
        confirmVariant: 'danger',
    });
  };

  const cancelEditing = useCallback(() => {
    setEditingEntry(null);
  }, []);

  const handleExportToPDF = async () => {
    setIsExporting(true);
    const exportContent = document.getElementById('export-content');
    if (!exportContent) {
        setIsExporting(false);
        return;
    }
    
    document.body.classList.add('exporting-pdf');

    try {
        const canvas = await html2canvas(exportContent, { scale: 2, logging: false, useCORS: true });
        document.body.classList.remove('exporting-pdf');

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgProps = pdf.getImageProperties(imgData);
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

        let heightLeft = pdfHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();

        while (heightLeft >= 0) {
          position = heightLeft - pdfHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
          heightLeft -= pdf.internal.pageSize.getHeight();
        }
        
        const monthName = monthNames[reportDate.getMonth()];
        const yearShort = reportDate.getFullYear().toString().slice(-2);
        const fileName = `Wochenzettel_${monthName}_${yearShort}.pdf`;
        pdf.save(fileName);

    } catch (err) {
        console.error("PDF Export failed:", err);
        alert("Entschuldigung, beim Erstellen des PDFs ist ein Fehler aufgetreten.");
        document.body.classList.remove('exporting-pdf');
    } finally {
        setIsExporting(false);
    }
  };

  const handleSave = () => {
    const dataToSave = JSON.stringify({ employeeName, entries, savedLocations, baseOvertime }, null, 2);
    const blob = new Blob([dataToSave], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const monthName = monthNames[reportDate.getMonth()];
    const yearShort = reportDate.getFullYear().toString().slice(-2);
    const fileName = `Wochenzettel_${monthName}_${yearShort}.json`;
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrepareShare = async () => {
    if (!navigator.share || entries.length === 0) return;

    setShareState('preparing');
    setShareError(null);
    setShareFiles(null);
    setIsSettingsOpen(false); // Close dropdown for better UX

    const exportContent = document.getElementById('export-content');
    if (!exportContent) {
        setShareError("Der zu exportierende Inhalt konnte nicht gefunden werden.");
        setShareState('error');
        return;
    }

    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        document.body.classList.add('exporting-pdf');
        const canvas = await html2canvas(exportContent, { scale: 2, logging: false, useCORS: true });
        document.body.classList.remove('exporting-pdf');

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgProps = pdf.getImageProperties(imgData);
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        let heightLeft = pdfHeight;
        let position = 0;
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();
        while (heightLeft >= 0) {
          position = heightLeft - pdfHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
          heightLeft -= pdf.internal.pageSize.getHeight();
        }
        const pdfBlob = pdf.output('blob');
        
        const dataToSave = JSON.stringify({ employeeName, entries, savedLocations, baseOvertime }, null, 2);
        const jsonBlob = new Blob([dataToSave], { type: 'application/json' });

        const monthName = monthNames[reportDate.getMonth()];
        const yearShort = reportDate.getFullYear().toString().slice(-2);
        const baseFileName = `Wochenzettel_${monthName}_${yearShort}`;
        const pdfFileName = `${baseFileName}.pdf`;
        const jsonFileName = `${baseFileName}.json`;

        const pdfFile = new File([pdfBlob], pdfFileName, { type: 'application/pdf' });
        const jsonFile = new File([jsonBlob], jsonFileName, { type: 'application/json' });
        
        setShareFiles({ pdf: pdfFile, json: jsonFile });
        setShareState('ready');

    } catch (err) {
        console.error("File preparation for sharing failed:", err);
        setShareError(err instanceof Error ? err.message : "Ein unbekannter Fehler ist aufgetreten.");
        setShareState('error');
    }
  };

  const executeShare = async () => {
    if (!shareFiles || !navigator.canShare || !navigator.canShare({ files: [shareFiles.pdf, shareFiles.json] })) {
        setShareError("Ihr Browser unterstützt das Teilen dieser Art von Dateien nicht.");
        setShareState('error');
        return;
    }

    try {
        await navigator.share({
            title: `Wochenzettel ${shareFiles.pdf.name.replace('.pdf', '')}`,
            text: `Wochenzettel für ${employeeName} im ${currentMonthYear}.`,
            files: [shareFiles.pdf, shareFiles.json],
        });
        setShareState('idle');
        setShareFiles(null);
    } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
             console.error("Sharing failed:", err);
             setShareError("Das Teilen wurde vom System abgelehnt. " + err.message);
             setShareState('error');
        } else {
             setShareState('idle');
             setShareFiles(null);
        }
    }
  };

  const handleLoadTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputElement = event.target;
    const file = inputElement.files?.[0];
    
    if (!file) {
      inputElement.value = '';
      return;
    }

    const processFile = () => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result;
          if (typeof text !== 'string') {
            throw new Error("Konnte Datei nicht als Text lesen.");
          }
          
          const data = JSON.parse(text);
          
          if (data && Array.isArray(data.entries)) {
            setEntries(data.entries);
            setEmployeeName(typeof data.employeeName === 'string' ? data.employeeName : '');
            setSavedLocations(Array.isArray(data.savedLocations) ? data.savedLocations : []);
            setBaseOvertime(typeof data.baseOvertime === 'number' ? data.baseOvertime : 0);
          } else {
            throw new Error("Ungültiges Dateiformat. Die Datei muss ein 'entries'-Array enthalten.");
          }
        } catch (err) {
          console.error("Fehler beim Laden der Datei:", err);
          alert(`Fehler beim Laden der Datei: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
        } finally {
            inputElement.value = '';
        }
      };

      reader.onerror = () => {
        alert("Fehler beim Lesen der Datei.");
        inputElement.value = '';
      };

      reader.readAsText(file);
    };
    
    setConfirmation({
        isOpen: true,
        title: 'Daten überschreiben',
        message: 'Möchten Sie die aktuellen Daten wirklich überschreiben? Nicht gespeicherte Änderungen gehen verloren.',
        onConfirm: () => {
            processFile();
            setConfirmation(null);
            setIsSettingsOpen(false);
        },
        onCancel: () => {
            inputElement.value = '';
            setConfirmation(null);
        },
        confirmText: 'Überschreiben',
        confirmVariant: 'danger',
    });
  };
  
  const handleNewDocument = () => {
    setConfirmation({
        isOpen: true,
        title: 'Neues Dokument erstellen',
        message: 'Möchten Sie wirklich ein neues Dokument erstellen? Alle aktuellen Einträge und Einstellungen werden unwiderruflich gelöscht.',
        onConfirm: () => {
            try {
                localStorage.clear();
                setEntries([]);
                setEmployeeName('');
                setSavedLocations([]);
                setBaseOvertime(0);
                setNewEntry(initialNewEntryState);
                setResetMessage('Alle lokalen Daten wurden erfolgreich entfernt.');
                setTimeout(() => setResetMessage(''), 4000);
              } catch (error) {
                console.error("Error clearing localStorage", error);
                alert("Fehler beim Löschen der Daten aus dem lokalen Speicher.");
              }
            setConfirmation(null);
            setIsSettingsOpen(false);
        },
        onCancel: () => setConfirmation(null),
        confirmText: 'Neues Dokument',
        confirmVariant: 'danger',
    });
  };
  
  const handleDeleteAllEntries = () => {
    setConfirmation({
        isOpen: true,
        title: 'Einträge löschen',
        message: 'Möchten Sie wirklich alle Einträge löschen? Ihre Einstellungen (Mitarbeitername, Überstunden, Orte) bleiben erhalten.',
        onConfirm: () => {
            setEntries([]);
            setResetMessage('Alle Einträge wurden erfolgreich gelöscht.');
            setTimeout(() => setResetMessage(''), 4000);
            setConfirmation(null);
            setIsSettingsOpen(false);
        },
        onCancel: () => setConfirmation(null),
        confirmText: 'Einträge löschen',
        confirmVariant: 'danger',
    });
  };

  const handleAddSavedLocation = (e: FormEvent) => {
    e.preventDefault();
    const locationToAdd = newSavedLocation.trim();
    if (locationToAdd && !savedLocations.some(l => l.toLowerCase() === locationToAdd.toLowerCase())) {
        setSavedLocations(prev => [...prev, locationToAdd].sort((a, b) => a.localeCompare(b, 'de')));
        setNewSavedLocation('');
    }
  };
  
  const handleDeleteSavedLocation = (locationToDelete: string) => {
      setSavedLocations(prev => prev.filter(l => l !== locationToDelete));
  };
  
  const handleCopyLocation = (locationToCopy: string) => {
      if (!navigator.clipboard) {
          alert("Kopieren nicht möglich. Ihr Browser unterstützt diese Funktion nicht oder die Seite wird nicht sicher (über HTTPS) geladen.");
          return;
      }
      navigator.clipboard.writeText(locationToCopy).then(() => {
          setCopiedLocation(locationToCopy);
          setTimeout(() => setCopiedLocation(null), 1500);
      }).catch(err => {
          console.error('Konnte den Text nicht kopieren: ', err);
          alert("Kopieren fehlgeschlagen.");
      });
  };

  const handleSavedLocationClick = useCallback((location: string) => {
    setNewEntry(prev => ({ ...prev, location }));
    locationInputRef.current?.focus();
  }, []);


  const isFormValid = newEntry.date && newEntry.location && (isSpecialEntry || (newEntry.startTime && newEntry.endTime));

  return (
    <main className="app-container">
      {editingEntry && (
        <EditModal 
            entry={editingEntry}
            onUpdate={handleUpdateEntry}
            onCancel={cancelEditing}
            savedLocations={savedLocations}
        />
      )}
      {confirmation?.isOpen && (
          <ConfirmModal
            title={confirmation.title}
            message={confirmation.message}
            onConfirm={confirmation.onConfirm}
            onCancel={confirmation.onCancel}
            confirmText={confirmation.confirmText}
            confirmVariant={confirmation.confirmVariant}
          />
      )}
      {shareState !== 'idle' && (
        <div className="modal-overlay" onClick={() => { if (shareState !== 'preparing') setShareState('idle'); }}>
          <div className="modal-content share-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Dateien teilen</h2>
              <button type="button" className="close-button" onClick={() => setShareState('idle')} aria-label="Schließen" disabled={shareState === 'preparing'}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="share-status">
                {shareState === 'preparing' && (
                  <>
                    <div className="spinner"></div>
                    <p>Dateien werden vorbereitet...</p>
                    <p><small>Dieser Vorgang kann einen Moment dauern.</small></p>
                  </>
                )}
                {shareState === 'ready' && (
                  <>
                    <p>Ihre Dateien sind zum Teilen bereit.</p>
                  </>
                )}
                {shareState === 'error' && (
                  <div className="error-message">
                    <p><strong>Fehler beim Vorbereiten der Dateien:</strong></p>
                    <p>{shareError || "Ein unbekannter Fehler ist aufgetreten."}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
               {shareState === 'ready' && shareFiles && (
                    <button type="button" className="submit-button" onClick={executeShare}>
                        Jetzt Teilen
                    </button>
                )}
               {shareState !== 'preparing' && (
                 <button type="button" className="cancel-button" onClick={() => setShareState('idle')}>
                    Abbrechen
                 </button>
               )}
            </div>
          </div>
        </div>
      )}

      <datalist id="saved-locations-list">
        {savedLocations.map(loc => <option key={loc} value={loc} />)}
      </datalist>

      <header className="app-header">
        <h1 className="main-title">Wochenzettel</h1>
        <div className="settings-menu" ref={settingsMenuRef}>
            <button className="settings-menu-button" onClick={() => setIsSettingsOpen(prev => !prev)} aria-label="Einstellungen öffnen">
                ⚙️
            </button>
            {isSettingsOpen && (
                <div className="settings-dropdown">
                    <div className="settings-section">
                        <h3>Einstellungen & Export</h3>
                         <div className="form-group">
                            <label htmlFor="employeeName">Mitarbeitername</label>
                            <input type="text" id="employeeName" name="employeeName" value={employeeName} onChange={handleNameChange} placeholder="Namen eingeben..."/>
                        </div>
                        <div className="form-group">
                            <label htmlFor="baseOvertime">Basis-Überstunden (Korrektur)</label>
                            <input 
                                type="number" 
                                id="baseOvertime" 
                                name="baseOvertime" 
                                value={baseOvertime === 0 && !document.activeElement?.id.includes('baseOvertime') ? '' : baseOvertime} 
                                onChange={handleBaseOvertimeChange} 
                                placeholder="z.B. 10.5 oder -5"
                                step="0.01"
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="reportMonth">Berichtsmonat</label>
                            <div className="date-select-group">
                                <select
                                    id="reportMonth"
                                    aria-label="Monat auswählen"
                                    value={reportDate.getMonth()}
                                    onChange={handleMonthChange}
                                >
                                    {monthNames.map((month, index) => (
                                    <option key={index} value={index}>{month}</option>
                                    ))}
                                </select>
                                <select
                                    aria-label="Jahr auswählen"
                                    value={reportDate.getFullYear()}
                                    onChange={handleYearChange}
                                >
                                    {yearRange.map(year => (
                                    <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <button onClick={handleExportToPDF} className="export-button" disabled={isExporting || entries.length === 0}>
                            {isExporting ? 'Exportiere...' : 'Als PDF speichern'}
                        </button>
                    </div>
                    
                    <div className="settings-section">
                        <h3>Datenverwaltung</h3>
                        <p className={`save-indicator ${saveIndicatorText === 'Gespeichert!' ? 'visible' : ''}`}>{saveIndicatorText}</p>
                        
                        {navigator.share && (
                            <button 
                                onClick={handlePrepareShare} 
                                className="share-button" 
                                disabled={shareState !== 'idle' || isExporting || entries.length === 0}
                            >
                                {shareState === 'preparing' ? 'Dateien werden erstellt...' : 'Senden / Teilen'}
                            </button>
                        )}
                        
                        <div className="file-actions">
                            <button onClick={handleLoadTrigger} className="file-button">Laden</button>
                            <button onClick={handleSave} className="file-button" disabled={entries.length === 0}>Speichern</button>
                            <button onClick={handleDeleteAllEntries} className="file-button reset-button" title="Löscht nur die Zeiteinträge.">Einträge löschen</button>
                            <button onClick={handleNewDocument} className="file-button reset-button" title="Löscht alle Einträge und Einstellungen.">Neues Dokument</button>
                        </div>
                        {resetMessage && <div className="reset-message">{resetMessage}</div>}
                        <input type="file" ref={fileInputRef} onChange={handleFileSelected} style={{ display: 'none' }} accept=".json" />
                    </div>
                </div>
            )}
        </div>
      </header>
        
      <div className="main-grid-layout">
          <aside className="saved-locations-card" aria-labelledby="saved-locations-heading">
              <h2 id="saved-locations-heading" className="card-title">Gespeicherte Orte</h2>
               <form onSubmit={handleAddSavedLocation} className="saved-location-form">
                  <input 
                      type="text" 
                      value={newSavedLocation} 
                      onChange={e => setNewSavedLocation(e.target.value)} 
                      placeholder="Neuen Ort hinzufügen..." 
                      aria-label="Neuen Ort hinzufügen"
                  />
                  <button type="submit" aria-label="Ort hinzufügen" disabled={!newSavedLocation.trim()}>+</button>
              </form>
              {savedLocations.length > 0 && (
                  <ul className="saved-locations-list">
                      {savedLocations.map(loc => (
                          <li key={loc}>
                              <button className="location-name-button" onClick={() => handleSavedLocationClick(loc)} title={`"${loc}" in aktuelles Formular einfügen`}>
                                  {loc}
                              </button>
                              <div className="location-item-actions">
                                  <button onClick={() => handleCopyLocation(loc)} title={`${loc} kopieren`}>
                                      {copiedLocation === loc ? '✅' : '📋'}
                                  </button>
                                  <button onClick={() => handleDeleteSavedLocation(loc)} title={`${loc} löschen`}>
                                      🗑️
                                  </button>
                              </div>
                          </li>
                      ))}
                  </ul>
              )}
          </aside>
          
          <section className="form-card" aria-labelledby="form-heading">
            <h2 id="form-heading" className="sr-only">Neuer Eintrag</h2>
            <form className="entry-form" onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="date">Datum</label>
                <input type="date" id="date" name="date" value={newEntry.date} onChange={handleInputChange} required />
              </div>
              <div className="form-group">
                <label htmlFor="location">Ort / Auftrag</label>
                <input ref={locationInputRef} type="text" id="location" name="location" value={newEntry.location} onChange={handleInputChange} placeholder="z.B. Büro, Urlaub, Krank, Bereitschaft" list="saved-locations-list" required />
              </div>
              
              {locationLower === 'krank' && (
                <div className="form-group checkbox-group">
                    <input type="checkbox" id="isChildSick" name="isChildSick" checked={newEntry.isChildSick} onChange={handleInputChange}/>
                    <label htmlFor="isChildSick">Auf Kind krank</label>
                </div>
              )}
              
              {locationLower === 'bereitschaft' && (
                  <div className="form-group checkbox-group">
                    <input type="checkbox" id="hasDeployments" name="hasDeployments" checked={newEntry.hasDeployments} onChange={handleInputChange}/>
                    <label htmlFor="hasDeployments">Einsätze vorhanden?</label>
                </div>
              )}
              
              <div className="time-input-group">
                  <div className="form-group">
                    <label htmlFor="startTime">Von</label>
                    <input type="time" id="startTime" name="startTime" value={newEntry.startTime} onChange={handleInputChange} onBlur={handleNewEntryTimeBlur} disabled={isSpecialEntry} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="endTime">Bis</label>
                    <input type="time" id="endTime" name="endTime" value={newEntry.endTime} onChange={handleInputChange} onBlur={handleNewEntryTimeBlur} disabled={isSpecialEntry} />
                  </div>
              </div>

              {locationLower === 'bereitschaft' && newEntry.hasDeployments && (
                <div className="deployment-form-section">
                    <h3>Einsätze hinzufügen</h3>
                    <div className="deployment-inputs">
                        <div className="form-group">
                            <label htmlFor="dep-location">Einsatzort</label>
                            <input type="text" id="dep-location" name="location" value={currentDeployment.location} onChange={handleDeploymentChange} placeholder="Ort des Einsatzes" list="saved-locations-list"/>
                        </div>
                        <div className="form-group">
                            <label htmlFor="dep-startTime">Von</label>
                            <input type="time" id="dep-startTime" name="startTime" value={currentDeployment.startTime} onChange={handleDeploymentChange} onBlur={handleNewDeploymentTimeBlur} />
                        </div>
                        <div className="form-group">
                            <label htmlFor="dep-endTime">Bis</label>
                            <input type="time" id="dep-endTime" name="endTime" value={currentDeployment.endTime} onChange={handleDeploymentChange} onBlur={handleNewDeploymentTimeBlur} />
                        </div>
                        <button type="button" className="add-deployment-button" onClick={handleAddDeployment}>+</button>
                    </div>
                    {newEntry.deployments.length > 0 && (
                        <ul className="new-deployment-list">
                            {newEntry.deployments.map(dep => (
                                <li key={dep.id}>
                                    <span>{dep.location} ({dep.startTime} - {dep.endTime})</span>
                                    <button type="button" onClick={() => handleRemoveNewDeployment(dep.id)}>🗑️</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
              )}

              <div className="form-actions">
                <button type="submit" className="submit-button" disabled={!isFormValid}>Eintrag hinzufügen</button>
              </div>
            </form>
            <div className="form-actions secondary-actions">
                <button type="button" onClick={handleAddPause} className="secondary-button" disabled={entries.length === 0}>Pause (30 Min)</button>
                <button type="button" onClick={handleAddStandardDay} className="secondary-button">Standardtag</button>
                <button type="button" onClick={handleAddFriday} className="secondary-button">Freitag</button>
            </div>
            {error && <p className="error-message">{error}</p>}
          </section>
      </div>

      <div id="export-content">
          <header className="report-header">
            <h1>Wochenzettel</h1>
            {employeeName && (
                <p className="subtitle">{`${currentMonthYear} für ${employeeName}`}</p>
            )}
          </header>
    
          <section className="summary-container" aria-label="Zusammenfassung">
            <div className="summary-card">
              <h2>Überstunden Gesamt</h2>
              <p className={`hours ${summaryMetrics.totalOvertime >= 0 ? 'positive' : 'negative'}`}>
                {formatHours(summaryMetrics.totalOvertime)} <span className="unit">Std.</span>
              </p>
            </div>
            <div className="summary-card">
              <h2>Überstunden Monat</h2>
              <p className={`hours ${summaryMetrics.currentMonthOvertime >= 0 ? 'positive' : 'negative'}`}>
                {formatHours(summaryMetrics.currentMonthOvertime)} <span className="unit">Std.</span>
              </p>
            </div>
             <div className="summary-card">
              <h2>Gesamt Arbeitsstunden</h2>
              <p className="hours neutral">{summaryMetrics.totalWorkHours.toFixed(2)} <span className="unit">Std.</span></p>
            </div>
            <div className="summary-card">
              <h2>Urlaubstage</h2>
              <p className="hours neutral">{summaryMetrics.vacationDays}</p>
            </div>
            <div className="summary-card">
              <h2>Krankentage</h2>
              <p className="hours neutral">{summaryMetrics.sickDays}</p>
            </div>
            <div className="summary-card">
              <h2>Bereitschaftstage</h2>
              <p className="hours neutral">{summaryMetrics.onCallDays}</p>
            </div>
          </section>

          <section className="table-container" aria-label="Zeiteinträge">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Ort / Auftrag</th>
                  <th>Von</th>
                  <th>Bis</th>
                  <th>Stunden</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.length > 0 ? (
                  sortedEntries.map((entry, index) => {
                    const locationLower = entry.location.trim().toLowerCase();
                    const isSpecialTimeEntry = locationLower === 'urlaub' || locationLower === 'krank' || locationLower === 'bereitschaft';
                    
                    let hoursDisplay;
                    if (locationLower === 'urlaub' || locationLower === 'krank' || locationLower === 'pause' || locationLower === 'bereitschaft') {
                        hoursDisplay = '-';
                    } else {
                        hoursDisplay = calculateHours(entry.startTime, entry.endTime).toFixed(2);
                    }
                    
                    const isNewDay = index > 0 && entry.date !== sortedEntries[index - 1].date;
                    const rowClasses = [
                        locationLower === 'pause' ? 'pause-row' : '',
                        isNewDay ? 'day-separator' : ''
                    ].filter(Boolean).join(' ');

                    return (
                      <React.Fragment key={entry.id}>
                        <tr className={rowClasses}>
                          <td data-label="Datum">{formatDate(entry.date)}</td>
                          <td data-label="Ort / Auftrag">
                            {entry.location}
                            {entry.isChildSick ? ' (Kind)' : ''}
                          </td>
                          <td data-label="Von">{isSpecialTimeEntry ? '-' : entry.startTime}</td>
                          <td data-label="Bis">{isSpecialTimeEntry ? '-' : entry.endTime}</td>
                          <td data-label="Stunden">{hoursDisplay}</td>
                          <td data-label="Aktionen">
                            <div className="action-buttons">
                                <button className="action-button" onClick={() => setEditingEntry(entry)} aria-label="Eintrag bearbeiten">✏️</button>
                                <button className="action-button" onClick={() => handleDeleteEntry(entry.id)} aria-label="Eintrag löschen">🗑️</button>
                            </div>
                          </td>
                        </tr>
                        {entry.deployments && entry.deployments.map(dep => (
                            <tr key={dep.id} className="deployment-row">
                                <td data-label="Datum"></td>
                                <td data-label="Ort / Auftrag">{dep.location}</td>
                                <td data-label="Von">{dep.startTime}</td>
                                <td data-label="Bis">{dep.endTime}</td>
                                <td data-label="Stunden">{calculateHours(dep.startTime, dep.endTime).toFixed(2)}</td>
                                <td></td>
                            </tr>
                        ))}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>Noch keine Einträge vorhanden.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
      </div>
    </main>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}