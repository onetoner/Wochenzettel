
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

// --- UTILITY FUNCTIONS ---
const calculateHours = (start: string, end: string): number => {
  if (!start || !end) return 0;
  const startTime = new Date(`1970-01-01T${start}:00`);
  const endTime = new Date(`1970-01-01T${end}:00`);
  if (endTime <= startTime) return 0;
  const diff = endTime.getTime() - startTime.getTime();
  return diff / (1000 * 60 * 60);
};

const formatHours = (hours: number): string => {
    const sign = hours < 0 ? "-" : "+";
    const absHours = Math.abs(hours);
    const h = Math.floor(absHours);
    const m = Math.round((absHours * 60) % 60);
    return `${sign} ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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

// --- EDIT MODAL COMPONENT ---
interface EditModalProps {
  entry: Entry;
  onUpdate: (updatedEntry: Entry) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}

const EditModal = ({ entry, onUpdate, onCancel, onDelete }: EditModalProps) => {
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

  const handleDeploymentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentDeployment(prev => ({ ...prev, [name]: value }));
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
        setError("Bei regulären Einträgen sind eine gültige Start- und Endzeit erforderlich.");
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

  const handleDeleteClick = () => {
    if (window.confirm('Möchten Sie diesen Eintrag wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
        onDelete(entry.id);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
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
                            <input type="text" id="edit-location" name="location" value={formData.location} onChange={handleInputChange} placeholder="z.B. Büro, Urlaub, Krank, Bereitschaft" required />
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

                        <div className="form-group">
                            <label htmlFor="edit-startTime">Von</label>
                            <input type="time" id="edit-startTime" name="startTime" value={formData.startTime} onChange={handleInputChange} disabled={isSpecialEntry} />
                        </div>
                        <div className="form-group">
                            <label htmlFor="edit-endTime">Bis</label>
                            <input type="time" id="edit-endTime" name="endTime" value={formData.endTime} onChange={handleInputChange} disabled={isSpecialEntry} />
                        </div>

                        {locationLower === 'bereitschaft' && formData.hasDeployments && (
                            <div className="deployment-form-section">
                                <h3>Einsätze</h3>
                                <div className="deployment-inputs">
                                    <div className="form-group">
                                        <label htmlFor="edit-dep-location">Einsatzort</label>
                                        <input type="text" id="edit-dep-location" name="location" value={currentDeployment.location} onChange={handleDeploymentChange} placeholder="Ort des Einsatzes" />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="edit-dep-startTime">Von</label>
                                        <input type="time" id="edit-dep-startTime" name="startTime" value={currentDeployment.startTime} onChange={handleDeploymentChange} />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="edit-dep-endTime">Bis</label>
                                        <input type="time" id="edit-dep-endTime" name="endTime" value={currentDeployment.endTime} onChange={handleDeploymentChange} />
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
                    <button type="button" className="delete-button" onClick={handleDeleteClick}>Löschen</button>
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
  
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('timesheetEntries', JSON.stringify(entries));
    } catch (error) {
      console.error("Error writing to localStorage", error);
    }
  }, [entries]);

  useEffect(() => {
    try {
        localStorage.setItem('employeeName', employeeName);
    } catch (error) {
        console.error("Error writing employee name to localStorage", error);
    }
  }, [employeeName]);

  const summaryMetrics: SummaryMetrics = useMemo(() => {
    const hoursByDay: Map<string, number> = new Map();
    const vacationDays = new Set<string>();
    const sickDays = new Set<string>();
    const onCallDays = new Set<string>();
    let pureWorkHours = 0;
    
    entries.forEach(entry => {
        const location = entry.location.trim().toLowerCase();
        const currentHours = hoursByDay.get(entry.date) || 0;
        let hoursToAdd = 0;

        if (location === 'urlaub') {
            hoursToAdd = 8;
            vacationDays.add(entry.date);
        } else if (location === 'krank') {
            hoursToAdd = 8;
            sickDays.add(entry.date);
        } else if (location === 'bereitschaft') {
            hoursToAdd = 8; // Pauschale für Überstundenberechnung
            onCallDays.add(entry.date);
            if(entry.deployments) {
                entry.deployments.forEach(dep => {
                    pureWorkHours += calculateHours(dep.startTime, dep.endTime);
                });
            }
        } else {
            hoursToAdd = calculateHours(entry.startTime, entry.endTime);
            pureWorkHours += hoursToAdd;
        }
        hoursByDay.set(entry.date, currentHours + hoursToAdd);
    });

    let totalOvertime = 0;
    let currentMonthOvertime = 0;
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;

    for (const [date, hours] of hoursByDay.entries()) {
        const dailyOvertime = hours - 8;
        totalOvertime += dailyOvertime;

        if (date.startsWith(currentMonthStr)) {
            currentMonthOvertime += dailyOvertime;
        }
    }

    return { 
        totalOvertime, 
        currentMonthOvertime,
        totalWorkHours: pureWorkHours,
        vacationDays: vacationDays.size,
        sickDays: sickDays.size,
        onCallDays: onCallDays.size,
    };
  }, [entries]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [entries]);
  
  const currentMonthYear = useMemo(() => {
    return new Intl.DateTimeFormat('de-DE', {
        month: 'long',
        year: 'numeric'
    }).format(new Date());
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setNewEntry(prev => ({ 
        ...prev, 
        [name]: type === 'checkbox' ? checked : value 
    }));
  };
  
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmployeeName(e.target.value);
  };

  const handleDeploymentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentDeployment(prev => ({ ...prev, [name]: value }));
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
        setError("Bei regulären Einträgen sind eine gültige Start- und Endzeit erforderlich.");
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
    setNewEntry(initialNewEntryState);
  };
  
  const handleUpdateEntry = useCallback((updatedEntry: Entry) => {
    setEntries(prev => prev.map(e => (e.id === updatedEntry.id ? updatedEntry : e)));
    setEditingEntry(null);
  }, []);
  
  const handleDeleteEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    setEditingEntry(null);
  }, []);

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
        
        const safeEmployeeName = employeeName.replace(/\s+/g, '_') || 'Unbenannt';
        const fileName = `Wochenzettel_${safeEmployeeName}_${new Date().toLocaleDateString('de-DE')}.pdf`;
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
    const dataToSave = JSON.stringify({ employeeName, entries }, null, 2);
    const blob = new Blob([dataToSave], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeEmployeeName = employeeName.replace(/\s+/g, '_') || 'Unbenannt';
    link.href = url;
    link.download = `wochenzettel_data_${safeEmployeeName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleLoadTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("Möchten Sie die aktuellen Daten wirklich überschreiben? Nicht gespeicherte Änderungen gehen verloren.")) {
      event.target.value = ''; // Reset file input
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') throw new Error("Konnte Datei nicht als Text lesen.");
        
        const data = JSON.parse(text);
        if (data && Array.isArray(data.entries) && typeof data.employeeName === 'string') {
          setEntries(data.entries);
          setEmployeeName(data.employeeName);
        } else {
          throw new Error("Ungültiges Dateiformat.");
        }
      } catch (err) {
        console.error("Fehler beim Laden der Datei:", err);
        alert(`Fehler beim Laden der Datei: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
      } finally {
          event.target.value = ''; // Reset file input to allow loading the same file again
      }
    };
    reader.readAsText(file);
  };
  
  const handleNewDocument = () => {
    if (window.confirm("Möchten Sie wirklich ein neues Dokument erstellen? Alle aktuellen, nicht gespeicherten Daten gehen verloren.")) {
      setEntries([]);
      setEmployeeName('');
      setNewEntry(initialNewEntryState);
    }
  };


  const isFormValid = newEntry.date && newEntry.location && (isSpecialEntry || (newEntry.startTime && newEntry.endTime));

  return (
    <main className="app-container">
      {editingEntry && (
        <EditModal 
            entry={editingEntry}
            onUpdate={handleUpdateEntry}
            onCancel={cancelEditing}
            onDelete={handleDeleteEntry}
        />
      )}

      <section className="app-controls">
        <div className="control-card">
          <h2>Einstellungen & Export</h2>
          <div className="form-group">
            <label htmlFor="employeeName">Mitarbeitername</label>
            <input type="text" id="employeeName" name="employeeName" value={employeeName} onChange={handleNameChange} placeholder="Namen eingeben..."/>
          </div>
          <button onClick={handleExportToPDF} className="export-button" disabled={isExporting || entries.length === 0}>
              {isExporting ? 'Exportiere...' : 'Als PDF speichern'}
          </button>
          <hr />
          <h3>Datenverwaltung</h3>
          <div className="file-actions">
            <button onClick={handleLoadTrigger} className="file-button">Laden</button>
            <button onClick={handleSave} className="file-button" disabled={entries.length === 0}>Speichern</button>
            <button onClick={handleNewDocument} className="file-button new-doc-button">Neues Dokument</button>
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileSelected} style={{ display: 'none' }} accept=".json" />
        </div>
        
        <div className="control-card">
            <section className="form-card" aria-labelledby="form-heading">
              <h2 id="form-heading">Neuer Eintrag</h2>
              <form className="entry-form" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="date">Datum</label>
                  <input type="date" id="date" name="date" value={newEntry.date} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label htmlFor="location">Ort / Auftrag</label>
                  <input type="text" id="location" name="location" value={newEntry.location} onChange={handleInputChange} placeholder="z.B. Büro, Urlaub, Krank, Bereitschaft" required />
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

                <div className="form-group">
                  <label htmlFor="startTime">Von</label>
                  <input type="time" id="startTime" name="startTime" value={newEntry.startTime} onChange={handleInputChange} disabled={isSpecialEntry} />
                </div>
                <div className="form-group">
                  <label htmlFor="endTime">Bis</label>
                  <input type="time" id="endTime" name="endTime" value={newEntry.endTime} onChange={handleInputChange} disabled={isSpecialEntry} />
                </div>
                
                {locationLower === 'bereitschaft' && newEntry.hasDeployments && (
                  <div className="deployment-form-section">
                      <h3>Einsätze hinzufügen</h3>
                      <div className="deployment-inputs">
                          <div className="form-group">
                              <label htmlFor="dep-location">Einsatzort</label>
                              <input type="text" id="dep-location" name="location" value={currentDeployment.location} onChange={handleDeploymentChange} placeholder="Ort des Einsatzes" />
                          </div>
                          <div className="form-group">
                              <label htmlFor="dep-startTime">Von</label>
                              <input type="time" id="dep-startTime" name="startTime" value={currentDeployment.startTime} onChange={handleDeploymentChange} />
                          </div>
                          <div className="form-group">
                              <label htmlFor="dep-endTime">Bis</label>
                              <input type="time" id="dep-endTime" name="endTime" value={currentDeployment.endTime} onChange={handleDeploymentChange} />
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
              {error && <p className="error-message">{error}</p>}
            </section>
        </div>
      </section>
      
      <div id="export-content">
          <header>
            <h1>Wochenzettel</h1>
            {employeeName && (
                <p className="subtitle">{`${currentMonthYear} für ${employeeName}`}</p>
            )}
          </header>
    
          <section className="summary-container" aria-label="Zusammenfassung">
            <div className="summary-card">
              <h2>Überstunden Gesamt</h2>
              <p className={`hours ${summaryMetrics.totalOvertime >= 0 ? 'positive' : 'negative'}`}>{formatHours(summaryMetrics.totalOvertime)}</p>
            </div>
            <div className="summary-card">
              <h2>Überstunden Monat</h2>
              <p className={`hours ${summaryMetrics.currentMonthOvertime >= 0 ? 'positive' : 'negative'}`}>{formatHours(summaryMetrics.currentMonthOvertime)}</p>
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
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.length > 0 ? (
                  sortedEntries.map(entry => {
                    const locationLower = entry.location.trim().toLowerCase();
                    const isSpecialEntry = locationLower === 'urlaub' || locationLower === 'krank' || locationLower === 'bereitschaft';
                    const hours = isSpecialEntry ? 8 : calculateHours(entry.startTime, entry.endTime);
                    return (
                      <React.Fragment key={entry.id}>
                        <tr>
                          <td data-label="Datum">{formatDate(entry.date)}</td>
                          <td data-label="Ort / Auftrag">
                            {entry.location}
                            {entry.isChildSick ? ' (Kind)' : ''}
                          </td>
                          <td data-label="Von">{isSpecialEntry ? '-' : entry.startTime}</td>
                          <td data-label="Bis">{isSpecialEntry ? '-' : entry.endTime}</td>
                          <td data-label="Stunden">{hours.toFixed(2)}</td>
                          <td data-label="Aktion">
                            <button className="edit-button" onClick={() => setEditingEntry(entry)} aria-label="Eintrag bearbeiten">✏️</button>
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
