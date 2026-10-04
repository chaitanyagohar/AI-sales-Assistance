"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  LayoutDashboard,
  Users,
  Mail,
  Settings,
  RefreshCw,
  X,
  Send,
  Globe,
  Phone,
  MessageCircle,
  Building2,
  AlertCircle,
  Trash2,
  Store
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Lead {
  id: number;
  name: string;
  category: string;
  status: string;
  email: string;
  phone: string;
  whatsapp: string | null;
  website: string | null;
  source: string;
  message_body: string | null;
  whatsapp_message: string | null;
  send_status: string;
  city: string | null;
  email_sent?: boolean;
  replied?: boolean;
}

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editableMessage, setEditableMessage] = useState<string>("");

  // Source selection state
  const [sources, setSources] = useState({
    googleMaps: true,
    ninetyNineAcres: false,
    magicBricks: false,
  });
  const [targetCity, setTargetCity] = useState<string>("Gurgaon");
  const [reraUrl, setReraUrl] = useState<string>("");

  // --- Filter States ---
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("latest");
  const [contactFilter, setContactFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeCardFilter, setActiveCardFilter] = useState("all"); 

  const fetchSettings = async () => {
    const { data } = await supabase
      .from("scraping_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (data) {
      setSources({
        googleMaps: data.google_maps,
        ninetyNineAcres: data.ninety_nine_acres,
        magicBricks: data.magic_bricks,
      });
      if (data.target_city) setTargetCity(data.target_city);
      if (data.rera_url) setReraUrl(data.rera_url);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("leads")
      .select("*")
      .order("id", { ascending: false });
    if (data) setLeads(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLeads();
    fetchSettings();
  }, []);

  // --- Filtering & Sorting Engine ---
  const filteredAndSortedLeads = useMemo(() => {
    let result = [...leads];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (lead) =>
          lead.name?.toLowerCase().includes(q) ||
          lead.city?.toLowerCase().includes(q) ||
          lead.source?.toLowerCase().includes(q),
      );
    }

    if (contactFilter !== "all") {
      result = result.filter((lead) => {
        const hasEmail = lead.email && !lead.email.includes("Not Found") && !lead.email.includes("Pending");
        const hasPhone = lead.phone && !lead.phone.includes("Not Found") && !lead.phone.includes("Pending");

        if (contactFilter === "email_only") return hasEmail && !hasPhone;
        if (contactFilter === "phone_only") return !hasEmail && hasPhone;
        if (contactFilter === "both") return hasEmail && hasPhone;
        return true;
      });
    }

    if (statusFilter !== "all") {
      result = result.filter((lead) => {
        if (statusFilter === "pending_approval") return lead.send_status === "Pending Review";
        if (statusFilter === "pending_enriched") return lead.email?.includes("Pending");
        if (statusFilter === "pending_pitch") return lead.status === "Enriched - Ready";
        if (statusFilter === "replied") return lead.status?.includes("Replied") || lead.replied;
        return true;
      });
    }

    if (activeCardFilter === "sent") {
      result = result.filter((lead) => lead.status === "Contacted");
    } else if (activeCardFilter === "replied") {
      result = result.filter((lead) => lead.status?.includes("Replied") || lead.replied);
    }

    result.sort((a, b) => {
      return sortBy === "latest" ? b.id - a.id : a.id - b.id;
    });

    return result;
  }, [leads, searchQuery, sortBy, contactFilter, statusFilter, activeCardFilter]);

  const toggleSource = async (
    sourceKey: "google_maps" | "ninety_nine_acres" | "magic_bricks",
    currentValue: boolean,
  ) => {
    const newValue = !currentValue;
    if (sourceKey === "google_maps") setSources({ ...sources, googleMaps: newValue });
    if (sourceKey === "ninety_nine_acres") setSources({ ...sources, ninetyNineAcres: newValue });
    if (sourceKey === "magic_bricks") setSources({ ...sources, magicBricks: newValue });

    await supabase
      .from("scraping_settings")
      .update({ [sourceKey]: newValue })
      .eq("id", 1);
  };

  const openLeadModal = (lead: Lead) => {
    setSelectedLead(lead);
    setEditableMessage(lead.message_body || "");
  };

  const updateStatus = async (newStatus: string) => {
    if (!selectedLead) return;
    await supabase
      .from("leads")
      .update({ status: newStatus })
      .eq("id", selectedLead.id);
    setSelectedLead({ ...selectedLead, status: newStatus });
    fetchLeads();
  };

  const deleteLead = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const isConfirmed = window.confirm("Are you sure you want to delete this lead permanently?");
    if (!isConfirmed) return;

    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
      setLeads((prevLeads) => prevLeads.filter((lead) => lead.id !== id));
      if (selectedLead?.id === id) {
        setSelectedLead(null);
      }
    } catch (err) {
      console.error("Error deleting lead:", err);
      alert("Failed to delete lead. Check console.");
    }
  };

  const handleSendMessage = async () => {
    if (!selectedLead) return;

    const subjectLine = `Loved your projects at ${selectedLead.name} (quick idea)`;

    try {
      const response = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedLead.email,
          subject: subjectLine,
          body: editableMessage,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        alert("Failed to send email. Check console for details.");
        console.error(result.error);
        return;
      }

      await supabase
        .from("leads")
        .update({
          message_body: editableMessage,
          send_status: "Sent",
          status: "Contacted",
        })
        .eq("id", selectedLead.id);

      alert("✅ Outreach sent successfully!");
      setSelectedLead(null);
      fetchLeads();
    } catch (err) {
      console.error("Network error while sending email:", err);
      alert("Network error. Could not reach the email server.");
    }
  };

  const pendingReviewCount = leads.filter((l) => l.send_status === "Pending Review").length;
  const enrichedCount = leads.filter((l) => l.email !== "Pending Verification" && l.email !== null).length;
  const totalSent = leads.filter((l) => l.status === "Contacted").length;
  const totalReplied = leads.filter((l) => l.status?.includes("Replied") || l.replied).length;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      
      {/* Sidebar Navigation */}
      <aside className="w-20 lg:w-64 bg-white border-r border-slate-200 flex flex-col z-10 transition-all">
        <div className="p-4 lg:p-6 border-b border-slate-200 flex items-center justify-center lg:justify-start">
          <div className="bg-blue-600 text-white p-2 rounded-lg lg:mr-3">
            <Building2 size={24} />
          </div>
          <div className="hidden lg:block">
            <h1 className="text-xl font-bold tracking-tight">Oddlambda</h1>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">
              AI Sales Engine
            </p>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {/* Active Tab */}
          <a
            href="/"
            className="flex items-center space-x-3 px-4 py-3 text-blue-700 bg-blue-50 rounded-xl transition-all font-semibold"
          >
            <LayoutDashboard size={20} />
            <span className="hidden lg:block">Real Estate</span>
          </a>
          
          {/* Inactive Tab */}
          <a
            href="/multi-business"
            className="flex items-center space-x-3 px-4 py-3 text-slate-600 hover:text-blue-700 hover:bg-blue-50/50 rounded-xl transition-all font-medium"
          >
            <Store size={20} />
            <span className="hidden lg:block">Local Business</span>
          </a>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold">Campaign Control Center</h2>
              <p className="text-slate-500 text-sm mt-1">
                Review AI drafts and manage your real estate pipeline.
              </p>
            </div>
            <button
              onClick={fetchLeads}
              className="flex items-center space-x-2 bg-white border border-slate-200 shadow-sm px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all"
            >
              <RefreshCw size={16} className={loading ? "animate-spin text-blue-600" : "text-slate-500"} />
              <span>Sync Database</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Leads</p>
                <p className="text-3xl font-bold mt-1">{leads.length}</p>
              </div>
              <div className="bg-slate-100 p-3 rounded-xl">
                <Users className="text-slate-600" size={24} />
              </div>
            </div>
            
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">Enriched Contacts</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{enrichedCount}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-xl">
                <Mail className="text-green-600" size={24} />
              </div>
            </div>
            
            <div className="bg-white p-5 rounded-2xl border border-blue-200 shadow-sm flex items-center justify-between bg-blue-50/50">
              <div>
                <p className="text-sm text-blue-600 font-medium">Pending Approvals</p>
                <p className="text-3xl font-bold mt-1 text-blue-700">{pendingReviewCount}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-xl">
                <AlertCircle className="text-blue-600" size={24} />
              </div>
            </div>

            <div 
              onClick={() => setActiveCardFilter(activeCardFilter === "sent" ? "all" : "sent")}
              className={`cursor-pointer bg-white p-5 rounded-2xl border flex items-center justify-between transition-all ${
                activeCardFilter === "sent" ? "border-blue-500 shadow-md ring-1 ring-blue-500" : "border-slate-200 shadow-sm hover:border-blue-300 hover:shadow"
              }`}
            >
              <div>
                <p className="text-sm text-slate-500 font-medium">Emails Sent</p>
                <h3 className="text-3xl font-bold mt-1 text-slate-900">{totalSent}</h3>
              </div>
              <div className="bg-blue-50 text-blue-600 p-3 rounded-xl">
                <Send size={24} />
              </div>
            </div>

            <div 
              onClick={() => setActiveCardFilter(activeCardFilter === "replied" ? "all" : "replied")}
              className={`cursor-pointer bg-white p-5 rounded-2xl border flex items-center justify-between transition-all ${
                activeCardFilter === "replied" ? "border-emerald-500 shadow-md ring-1 ring-emerald-500" : "border-slate-200 shadow-sm hover:border-emerald-300 hover:shadow"
              }`}
            >
              <div>
                <p className="text-sm text-slate-500 font-medium">Replied</p>
                <h3 className="text-3xl font-bold mt-1 text-slate-900">{totalReplied}</h3>
              </div>
              <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl">
                <MessageCircle size={24} />
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-6">
            <span className="text-sm font-semibold text-slate-700 ml-2">Data Sources:</span>
            <label className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors">
              <input
                type="checkbox"
                checked={sources.googleMaps}
                onChange={() => toggleSource("google_maps", sources.googleMaps)}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <span className="font-medium">Google Maps</span>
            </label>

            <label className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors">
              <input
                type="checkbox"
                checked={sources.ninetyNineAcres}
                onChange={() => toggleSource("ninety_nine_acres", sources.ninetyNineAcres)}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <span className="font-medium">99acres</span>
            </label>

            <div className="h-6 w-[1px] bg-slate-200 mx-2 hidden sm:block"></div>

            <div className="flex items-center space-x-2 text-sm">
              <span className="font-semibold text-slate-700">Target City:</span>
              <input
                type="text"
                value={targetCity}
                onChange={(e) => setTargetCity(e.target.value)}
                onBlur={async (e) => {
                  const newCity = e.target.value;
                  await supabase.from("scraping_settings").update({ target_city: newCity }).eq("id", 1);
                }}
                placeholder="e.g. Noida, Bangalore"
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
              />
            </div>

            <div className="h-6 w-[1px] bg-slate-200 mx-2 hidden sm:block"></div>

            <div className="flex items-center space-x-2 text-sm flex-1 min-w-[300px]">
              <span className="font-semibold text-slate-700 whitespace-nowrap">RERA Link:</span>
              <input
                type="text"
                value={reraUrl}
                onChange={(e) => setReraUrl(e.target.value)}
                onBlur={async (e) => {
                  const newUrl = e.target.value;
                  await supabase.from("scraping_settings").update({ rera_url: newUrl }).eq("id", 1);
                }}
                placeholder="Paste State RERA project link..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by name, location, or source..."
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer text-slate-700 focus:ring-2 focus:ring-blue-500"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="latest">Sort: Latest First</option>
                <option value="first">Sort: Oldest First</option>
              </select>

              <select
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer text-slate-700 focus:ring-2 focus:ring-blue-500"
                value={contactFilter}
                onChange={(e) => setContactFilter(e.target.value)}
              >
                <option value="all">Contact: All</option>
                <option value="both">Has Both Email & Phone</option>
                <option value="email_only">Email Only</option>
                <option value="phone_only">Phone Only</option>
              </select>

              <select
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer text-slate-700 focus:ring-2 focus:ring-blue-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Status: All</option>
                <option value="pending_enriched">Pending Enrichment</option>
                <option value="pending_pitch">Pending Pitch (Ready)</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="replied">Replied 🎉</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold tracking-wider">
                    <th className="px-6 py-4">Business Details</th>
                    <th className="px-6 py-4">Campaign Status</th>
                    <th className="px-6 py-4">Contact Info</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAndSortedLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 text-sm">{lead.name}</div>
                        <div className="text-xs text-slate-500 mt-1.5 flex items-center">
                          <span className="bg-slate-100 px-2 py-0.5 rounded mr-2">{lead.source}</span>
                          {lead.city && (
                            <span className="bg-blue-50 text-blue-700 font-medium px-2 py-0.5 rounded border border-blue-100">
                              📍 {lead.city}
                            </span>
                          )}
                          <span className="ml-2">{lead.category}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-start gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border uppercase tracking-wider ${
                              lead.status === "Replied 🎉"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300 animate-bounce"
                                : lead.status === "Enriched - Ready"
                                  ? "bg-green-50 text-green-700 border-green-200"
                                  : lead.status === "Contacted"
                                    ? "bg-purple-50 text-purple-700 border-purple-200"
                                    : lead.status === "Missing Data"
                                      ? "bg-red-50 text-red-700 border-red-200"
                                      : "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {lead.status}
                          </span>
                          {lead.send_status === "Pending Review" && (
                            <span className="flex items-center text-[11px] font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md border border-orange-100">
                              <span className="w-1.5 h-1.5 bg-orange-500 rounded-full mr-1.5 animate-pulse"></span>
                              Awaiting Approval
                            </span>
                          )}
                          {lead.send_status === "Sent" && (
                            <span className="flex items-center text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                              Sent Successfully
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-6">
                        <div className="flex flex-col gap-2 text-sm text-slate-700 font-medium">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                            {lead.email && !lead.email.includes("Not Found") && !lead.email.includes("Pending") ? (
                              <span>{lead.email}</span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">No email</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                            {lead.phone && !lead.phone.includes("Not Found") && !lead.phone.includes("Pending") ? (
                              <span>{lead.phone}</span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">No phone</span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openLeadModal(lead)}
                          className="inline-flex items-center justify-center bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm"
                        >
                          Review Lead
                        </button>
                        <button
                          onClick={(e) => deleteLead(lead.id, e)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-xl transition-all ml-2"
                          title="Delete Lead"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selectedLead && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
              <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">{selectedLead.name}</h3>
                  <p className="text-sm text-slate-500 mt-1 flex items-center">
                    <Globe size={14} className="mr-1" /> {selectedLead.source} Lead
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="text-slate-400 hover:text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-full p-2 transition-all shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-8">
                  <div>
                    <h4 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-3">Pipeline Stage</h4>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => updateStatus("Interested")}
                        className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${selectedLead.status === "Interested" ? "bg-green-50 border-green-200 text-green-700 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      >
                        Interested
                      </button>
                      <button
                        onClick={() => updateStatus("Not Sure")}
                        className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${selectedLead.status === "Not Sure" ? "bg-yellow-50 border-yellow-200 text-yellow-700 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      >
                        Not Sure
                      </button>
                      <button
                        onClick={() => updateStatus("Not Interested")}
                        className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${selectedLead.status === "Not Interested" ? "bg-red-50 border-red-200 text-red-700 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                      >
                        Not Interested
                      </button>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-3">Contact Intelligence</h4>
                    <div className="space-y-0 rounded-2xl border border-slate-200 overflow-hidden bg-white">
                      <div className="flex items-center p-4 border-b border-slate-100 text-sm">
                        <Mail size={18} className="text-slate-400 mr-4" />
                        <span className="font-medium text-slate-900">
                          {selectedLead.email !== "Pending Verification" ? selectedLead.email : "No email found"}
                        </span>
                      </div>
                      <div className="flex items-center p-4 border-b border-slate-100 text-sm bg-slate-50/50">
                        <Phone size={18} className="text-slate-400 mr-4" />
                        <span className="font-medium text-slate-900">{selectedLead.phone}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col h-full bg-slate-50 rounded-2xl border border-slate-200 p-1">
                  <div className="p-4 border-b border-slate-200 flex flex-col gap-3 bg-white rounded-t-xl">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">AI Generated Pitch</h4>
                      <p className="text-xs text-slate-400">Edit freely before dispatching.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditableMessage(selectedLead.message_body || "")}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          editableMessage === selectedLead.message_body || editableMessage.includes("Subject:")
                            ? "bg-blue-600 text-white shadow-sm"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        ✉️ Email Pitch
                      </button>
                      <button
                        onClick={() =>
                          setEditableMessage(
                            selectedLead.whatsapp_message ||
                              `Hi ${selectedLead.name}, saw your real estate projects—quick question, are you open to upgrading your landing pages for better lead conversions?`,
                          )
                        }
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          editableMessage === selectedLead.whatsapp_message
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        💬 WhatsApp Pitch (Brief)
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="flex-1 w-full p-5 bg-transparent border-none text-sm text-slate-700 focus:ring-0 resize-none font-mono leading-relaxed"
                    rows={editableMessage === selectedLead.whatsapp_message ? 4 : 8}
                    value={editableMessage}
                    onChange={(e) => setEditableMessage(e.target.value)}
                    placeholder="No AI draft available for this lead yet."
                  />

                  <div className="p-4 bg-white border-t border-slate-200 rounded-b-xl flex items-center gap-3">
                    <button
                      onClick={handleSendMessage}
                      className="flex-1 flex items-center justify-center bg-blue-600 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-blue-700 transition-all shadow-sm text-sm"
                    >
                      <Send size={16} className="mr-2" />
                      Approve & Send Email
                    </button>

<button
  onClick={() => {
    if (!selectedLead || !selectedLead.phone || selectedLead.phone.includes("Not Found")) {
      alert("No valid phone number available for this lead.");
      return;
    }
    
    // 1. Clean up the phone number (remove spaces, dashes)
    let cleanPhone = selectedLead.phone.replace(/[^0-9+]/g, '');
    
    // 2. Add India country code if it's just a 10-digit number
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    } else if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.replace('+', ''); // WhatsApp links prefer no '+' sign
    }

    // 3. Draft the exact message you requested
    const message = `Hi, is this the right number for ${selectedLead.name}?`;
    const encodedMessage = encodeURIComponent(message);
    
    // 4. Open WhatsApp directly in a new tab
    window.open(`https://wa.me/${cleanPhone}?text=${encodedMessage}`, '_blank');
    
    // 5. Instantly mark the lead as Contacted in the background so your CRM stays updated
    supabase
      .from("leads")
      .update({
        send_status: "Sent",
        status: "Contacted",
      })
      .eq("id", selectedLead.id)
      .then(() => {
        fetchLeads(); // Refresh the list slightly behind the scenes
      });
  }}
  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors shadow-sm text-sm flex items-center justify-center gap-2"
>
  <MessageCircle size={16} />
  <span>Send via WhatsApp</span>
</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}