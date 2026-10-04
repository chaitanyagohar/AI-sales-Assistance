"use client";

import React, { useEffect, useState, useMemo } from "react";
import { 
  Building2, Search, Globe, Phone, Mail, 
  MapPin, AlertTriangle, ExternalLink, RefreshCw, Send, MessageCircle,
  LayoutDashboard, Store, Users, AlertCircle, X, Star, Trash2, Sparkles, ChevronDown, ChevronUp
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const BASE_CATEGORIES = [
  "Restaurants", "Cafes", "Hotels", "Salons", "Gyms", 
  "Hospitals", "Clinics", "Dentists", "Schools", "Coaching Centres", 
  "Real Estate Agencies", "Builders", "Interior Designers", "Architects", 
  "Automobile Dealers", "Car Repair Shops", "Electronics Stores", 
  "Jewellery Stores", "Clothing Stores", "Lawyers"
];

interface MultiLead {
  id: number;
  business_name: string;
  category: string;
  city: string;
  address: string | null;
  contact_person: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  website_available: boolean;
  website_url: string | null;
  source: string;
  status: string;
  email_sent: boolean;
  replied: boolean;
  notes: string | null;
  is_good_site: boolean;
  is_garbage: boolean;
  ai_research?: any; // NEW: Optional AI Research Object
  created_at: string;
}

const isSocialUrl = (url: string | null) => {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('facebook.com') || 
         lowerUrl.includes('instagram.com') || 
         lowerUrl.includes('fb.me') || 
         lowerUrl.includes('instagr.am');
};

export default function MultiBusinessDashboard() {
  const [leads, setLeads] = useState<MultiLead[]>([]);
  const [loading, setLoading] = useState(true);

  // Scraper Trigger States
  const [scrapeCategory, setScrapeCategory] = useState("Dentists");
  const [scrapeCity, setScrapeCity] = useState("Delhi");
  const [scrapeCustom, setScrapeCustom] = useState("");
  const [isScraping, setIsScraping] = useState(false);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Categories");
  const [cityFilter, setCityFilter] = useState("all"); 
  const [websiteFilter, setWebsiteFilter] = useState("all"); 
  const [contactFilter, setContactFilter] = useState("all"); 
  const [outreachFilter, setOutreachFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("active"); 
  const [sortBy, setSortBy] = useState("latest");
  const [activeCardFilter, setActiveCardFilter] = useState("all"); 

  // Modal States
  const [selectedLead, setSelectedLead] = useState<MultiLead | null>(null);
  const [activeTab, setActiveTab] = useState<"whatsapp" | "email">("whatsapp");
  const [whatsappDraft, setWhatsappDraft] = useState<string>("");
  const [emailDraft, setEmailDraft] = useState<string>("");
  const [selectedCountryCode, setSelectedCountryCode] = useState("91"); 
  const [showResearchData, setShowResearchData] = useState(true); // NEW: Modal Research Toggle

  // NEW: Research Processing State
  const [researchingId, setResearchingId] = useState<number | null>(null);

  const fetchLeads = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("multi_business_leads")
      .select("*")
      .order("id", { ascending: false });
    if (data) setLeads(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    leads.forEach(lead => {
      const cat = lead.category || "Uncategorized";
      stats[cat] = (stats[cat] || 0) + 1;
    });
    return stats;
  }, [leads]);

  const allCategoriesForScraping = useMemo(() => {
    const dbCategories = Object.keys(categoryStats);
    return Array.from(new Set([...BASE_CATEGORIES, ...dbCategories])).sort();
  }, [categoryStats]);

  const uniqueCities = useMemo(() => {
    const cities = leads.map(l => l.city).filter(Boolean);
    return ["all", ...Array.from(new Set(cities))].sort();
  }, [leads]);

  const toggleState = async (id: number, field: keyof MultiLead, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('multi_business_leads')
        .update({ [field]: !currentValue })
        .eq('id', id);

      if (error) throw error;
      setLeads(prevLeads => prevLeads.map(lead => 
        lead.id === id ? { ...lead, [field]: !currentValue } : lead
      ));
    } catch (err) {
      alert("Failed to update status.");
      console.error(err);
    }
  };

  const handleLaunchScraper = async () => {
    if (!scrapeCategory.trim()) {
      alert("Please enter or select a target category.");
      return;
    }
    if (!scrapeCity.trim() && !scrapeCustom.trim()) {
      alert("Please enter a target city or a custom query.");
      return;
    }

    setIsScraping(true);
    try {
      const response = await fetch('/api/scrape-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: scrapeCategory,
          city: scrapeCity,
          customSearch: scrapeCustom
        })
      });

      const result = await response.json();
      if (result.success) {
        alert("🚀 " + result.message);
      } else {
        alert("❌ Error: " + result.error);
      }
    } catch (err) {
      alert("Network error failed to trigger scraper.");
    } finally {
      setIsScraping(false);
    }
  };

  // NEW: Trigger AI Research
  const handleRunResearch = async (lead: MultiLead) => {
    if (!lead.website_url) return;
    setResearchingId(lead.id);
    
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lead.id, url: lead.website_url })
      });
      const data = await res.json();
      
      if (data.success) {
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, ai_research: data.research } : l));
        if (selectedLead?.id === lead.id) {
          setSelectedLead({ ...selectedLead, ai_research: data.research });
        }
      } else {
        alert("Research API Failed: " + data.error);
      }
    } catch (err) {
      console.error("Network error during research:", err);
    } finally {
      setResearchingId(null);
    }
  };

  const openLeadModal = (lead: MultiLead) => {
    setSelectedLead(lead);
    setShowResearchData(true);
    
    if (!lead.phone && lead.email) {
      setActiveTab("email");
    } else {
      setActiveTab("whatsapp");
    }

    setWhatsappDraft(`Hi, is this the right number for ${lead.business_name}?`);

    const generatedEmail = `Hi Team at ${lead.business_name},\n\nI came across your business and noticed an opportunity to enhance your digital footprint. I run Oddlambda, an agency specializing in building high-converting websites and robust digital infrastructures for ${lead.category.toLowerCase()}.\n\nWould you be open to a quick chat about how we can improve your online presence and bring in more customers?\n\nYou can check out some of our recent projects and learn more at https://oddlambda.com.\n\nBest regards,\n\nChaitanya Gohar\nFounder, Oddlambda\nEmail: hello@oddlambda.com\nMobile: +91 8448052717 / +91 8800633353`;
    
    setEmailDraft(generatedEmail);
  };

  const handleSendEmail = async () => {
    if (!selectedLead || !selectedLead.email || selectedLead.email.includes("Not Found")) {
      alert("No valid email address available for this business.");
      return;
    }

    try {
      const response = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedLead.email,
          subject: `Ideas for improving ${selectedLead.business_name}'s online presence`,
          body: emailDraft,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        alert("Failed to send email. Check console for details.");
        console.error(result.error);
        return;
      }

      await supabase
        .from("multi_business_leads")
        .update({
          email_sent: true,
          status: "Contacted",
        })
        .eq("id", selectedLead.id);

      alert("✅ Email dispatched successfully!");
      setSelectedLead(null);
      fetchLeads();
    } catch (err) {
      console.error("Network error while sending email:", err);
      alert("Network error. Could not reach the email server.");
    }
  };

  const filteredAndSortedLeads = useMemo(() => {
    let result = [...leads];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (lead) =>
          lead.business_name?.toLowerCase().includes(q) ||
          lead.city?.toLowerCase().includes(q) ||
          lead.phone?.includes(q)
      );
    }

    if (selectedCategory !== "All Categories") {
      result = result.filter((lead) => lead.category === selectedCategory);
    }

    if (cityFilter !== "all") {
      result = result.filter((lead) => lead.city === cityFilter);
    }

    if (websiteFilter !== "all") {
      result = result.filter((lead) => 
        websiteFilter === "yes" ? lead.website_available : !lead.website_available
      );
    }

    if (qualityFilter === "active") {
      result = result.filter((lead) => !lead.is_garbage);
    } else if (qualityFilter === "garbage") {
      result = result.filter((lead) => lead.is_garbage);
    } else if (qualityFilter === "good_site") {
      result = result.filter((lead) => lead.is_good_site && !lead.is_garbage);
    } else if (qualityFilter === "social_only") {
      result = result.filter((lead) => isSocialUrl(lead.website_url) && !lead.is_garbage);
    }

    if (contactFilter !== "all") {
      result = result.filter((lead) => {
        const hasEmail = Boolean(lead.email && !lead.email.includes("Not Found") && !lead.email.includes("Pending"));
        const hasPhone = Boolean(lead.phone && !lead.phone.includes("Not Found") && !lead.phone.includes("Pending"));

        if (contactFilter === "both") return hasEmail && hasPhone;
        if (contactFilter === "phone_only") return hasPhone && !hasEmail;
        if (contactFilter === "email_only") return hasEmail && !hasPhone;
        if (contactFilter === "has_any") return hasPhone || hasEmail;
        if (contactFilter === "missing_any") return !hasPhone || !hasEmail;
        return true;
      });
    }

    if (activeCardFilter === "enriched") {
      result = result.filter((lead) => lead.email || lead.phone);
    } else if (activeCardFilter === "pending") {
      result = result.filter((lead) => !lead.email_sent && !lead.replied);
    } else if (activeCardFilter === "sent") {
      result = result.filter((lead) => lead.email_sent);
    } else if (activeCardFilter === "replied") {
      result = result.filter((lead) => lead.replied);
    }

    if (outreachFilter !== "all") {
      result = result.filter((lead) => {
        if (outreachFilter === "sent") return lead.email_sent && !lead.replied;
        if (outreachFilter === "replied") return lead.replied;
        if (outreachFilter === "none") return !lead.email_sent && !lead.replied;
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortBy === "priority") {
        return (a.website_available === b.website_available) ? 0 : a.website_available ? 1 : -1;
      }
      if (sortBy === "latest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === "name") return a.business_name.localeCompare(b.business_name);
      return 0;
    });

    return result;
  }, [leads, searchQuery, selectedCategory, cityFilter, websiteFilter, contactFilter, qualityFilter, activeCardFilter, outreachFilter, sortBy]);

  const enrichedCount = leads.filter((l) => l.email || l.phone).length;
  const pendingApprovalCount = leads.filter((l) => !l.email_sent && !l.replied).length;
  const totalSent = leads.filter((l) => l.email_sent).length;
  const totalReplied = leads.filter((l) => l.replied).length;

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
          <a
            href="/"
            className="flex items-center space-x-3 px-4 py-3 text-slate-600 hover:text-blue-700 hover:bg-blue-50/50 rounded-xl transition-all font-medium"
          >
            <LayoutDashboard size={20} />
            <span className="hidden lg:block">Real Estate</span>
          </a>
          
          <a
            href="/multi-business"
            className="flex items-center space-x-3 px-4 py-3 text-blue-700 bg-blue-50 rounded-xl transition-all font-semibold"
          >
            <Store size={20} />
            <span className="hidden lg:block">Local Business</span>
          </a>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <Store className="text-blue-600" size={28} />
                Multi-Business Lead Engine
              </h1>
              <p className="text-slate-500 mt-1 text-sm">
                Target local businesses lacking digital infrastructure. Priority goes to businesses without websites.
              </p>
            </div>
            <button
              onClick={fetchLeads}
              className="flex items-center space-x-2 bg-white border border-slate-300 shadow-sm px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all"
            >
              <RefreshCw size={16} className={loading ? "animate-spin text-blue-600" : "text-slate-500"} />
              <span>Sync Database</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
            <div 
              onClick={() => setActiveCardFilter("all")}
              className={`cursor-pointer bg-white p-5 rounded-2xl border flex items-center justify-between transition-all ${
                activeCardFilter === "all" ? "border-slate-800 shadow-md ring-1 ring-slate-800" : "border-slate-200 shadow-sm hover:border-slate-300 hover:shadow"
              }`}
            >
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Leads</p>
                <p className="text-3xl font-bold mt-1 text-slate-900">{leads.length}</p>
              </div>
              <div className="bg-slate-100 p-3 rounded-xl">
                <Users className="text-slate-600" size={24} />
              </div>
            </div>
            
            <div 
              onClick={() => setActiveCardFilter(activeCardFilter === "enriched" ? "all" : "enriched")}
              className={`cursor-pointer bg-white p-5 rounded-2xl border flex items-center justify-between transition-all ${
                activeCardFilter === "enriched" ? "border-green-500 shadow-md ring-1 ring-green-500" : "border-slate-200 shadow-sm hover:border-green-300 hover:shadow"
              }`}
            >
              <div>
                <p className="text-sm text-slate-500 font-medium">Enriched Contacts</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{enrichedCount}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-xl">
                <Mail className="text-green-600" size={24} />
              </div>
            </div>
            
            <div 
              onClick={() => setActiveCardFilter(activeCardFilter === "pending" ? "all" : "pending")}
              className={`cursor-pointer bg-white p-5 rounded-2xl border flex items-center justify-between transition-all ${
                activeCardFilter === "pending" ? "border-blue-500 shadow-md ring-1 ring-blue-500" : "border-blue-200 shadow-sm bg-blue-50/50 hover:border-blue-300 hover:shadow"
              }`}
            >
              <div>
                <p className="text-sm text-blue-600 font-medium">Pending Approvals</p>
                <p className="text-3xl font-bold mt-1 text-blue-700">{pendingApprovalCount}</p>
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

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Launch New Scraping Job</h2>
            <div className="flex flex-col md:flex-row gap-4 items-end">
              
              <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Target Category (Select or Type New)</label>
                <input 
                  type="text" 
                  list="scrape-categories"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={scrapeCategory}
                  onChange={(e) => setScrapeCategory(e.target.value)}
                  placeholder="e.g. Plumbers, Dentists..."
                />
                <datalist id="scrape-categories">
                  {allCategoriesForScraping.map(cat => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Target City</label>
                <input 
                  type="text" 
                  placeholder="e.g. Mumbai, Noida..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={scrapeCity}
                  onChange={(e) => setScrapeCity(e.target.value)}
                />
              </div>

              <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Custom Query (Optional Override)</label>
                <input 
                  type="text" 
                  placeholder="e.g. Pediatric Dentist in South Delhi"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={scrapeCustom}
                  onChange={(e) => setScrapeCustom(e.target.value)}
                />
              </div>

              <button
                onClick={handleLaunchScraper}
                disabled={isScraping}
                className={`px-6 py-2 rounded-lg text-sm font-bold text-white transition-all whitespace-nowrap h-[38px] ${
                  isScraping ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-sm"
                }`}
              >
                {isScraping ? "Triggering..." : "Launch Scraper"}
              </button>
            </div>
          </div>

          {/* Filtering Engine */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search business, city, or phone..." 
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer"
              value={selectedCategory} 
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="All Categories">All Categories ({leads.length})</option>
              {Object.entries(categoryStats)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([cat, count]) => (
                <option key={cat} value={cat}>{cat} ({count})</option>
              ))}
            </select>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer"
              value={cityFilter} 
              onChange={(e) => setCityFilter(e.target.value)}
            >
              <option value="all">City: All Cities</option>
              {uniqueCities.filter(c => c !== "all").map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer bg-red-50 text-red-900"
              value={qualityFilter} 
              onChange={(e) => setQualityFilter(e.target.value)}
            >
              <option value="active">Quality: Active Leads</option>
              <option value="all">Quality: All (Inc. Garbage)</option>
              <option value="good_site">⭐ Starred Sites</option>
              <option value="social_only">🔥 Prime: Social Only</option>
              <option value="garbage">🗑️ Garbage Leads</option>
            </select>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer bg-amber-50 text-amber-900"
              value={websiteFilter} 
              onChange={(e) => setWebsiteFilter(e.target.value)}
            >
              <option value="all">Website: All</option>
              <option value="no">🚨 No Website</option>
              <option value="yes">Has Website</option>
            </select>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer bg-emerald-50 text-emerald-900"
              value={contactFilter} 
              onChange={(e) => setContactFilter(e.target.value)}
            >
              <option value="all">Contact: All</option>
              <option value="both">Has Phone & Email</option>
              <option value="phone_only">Phone Only</option>
              <option value="email_only">Email Only</option>
              <option value="has_any">Has Any Contact</option>
              <option value="missing_any">Missing Email or Phone</option>
            </select>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer bg-indigo-50 text-indigo-900"
              value={outreachFilter} 
              onChange={(e) => setOutreachFilter(e.target.value)}
            >
              <option value="all">Outreach: All</option>
              <option value="none">Not Contacted</option>
              <option value="sent">Sent</option>
              <option value="replied">✅ Replied</option>
            </select>

            <select 
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium outline-none cursor-pointer"
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="latest">Sort: Latest</option>
              <option value="priority">Sort: Priority (No Web)</option>
              <option value="name">Sort: A-Z</option>
            </select>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold tracking-wider">
                    <th className="px-6 py-4">Business Profile</th>
                    <th className="px-6 py-4">Contact Intelligence</th>
                    <th className="px-6 py-4">Digital Presence</th>
                    <th className="px-6 py-4 text-right">Outreach Tracking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAndSortedLeads.map((lead) => (
                    <tr key={lead.id} className={`transition-colors ${lead.is_garbage ? "opacity-40 bg-slate-100" : lead.replied ? "bg-indigo-50/40" : !lead.website_available ? "bg-red-50/30" : "hover:bg-slate-50"}`}>
                      
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                          {lead.business_name}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-xs">
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">{lead.category}</span>
                          <span className="flex items-center text-slate-500"><MapPin size={12} className="mr-1"/> {lead.city}</span>
                        </div>
                        
                        <div className="flex gap-2 mt-2">
                          {lead.email_sent && <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase"><Send size={10} /> Sent</span>}
                          {lead.replied && <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase"><MessageCircle size={10} /> Replied</span>}
                          {lead.ai_research?.status === 'completed' && <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase"><Sparkles size={10} /> Analyzed</span>}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5 text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                            {lead.phone ? <span className="text-slate-700">{lead.phone}</span> : <span className="text-slate-400 italic text-xs">No phone</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                            {lead.email && !lead.email.includes("Not Found") ? <span className="text-slate-700">{lead.email}</span> : <span className="text-slate-400 italic text-xs">No email</span>}
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {!lead.website_available ? (
                            <div className="inline-flex items-center gap-1.5 bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-red-200">
                              <AlertTriangle size={14} />
                              NO WEBSITE
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <a 
                                  href={lead.website_url || "#"} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-100 hover:bg-emerald-100 transition-colors"
                                >
                                  <Globe size={14} />
                                  Visit Link <ExternalLink size={12} />
                                </a>
                                
                                {/* NEW: AI Trigger Button */}
                                <button
                                  onClick={() => handleRunResearch(lead)}
                                  disabled={researchingId === lead.id}
                                  className={`p-1.5 rounded-lg border transition-all ${
                                    researchingId === lead.id 
                                      ? "bg-purple-100 text-purple-400 border-purple-200 animate-pulse" 
                                      : "bg-white text-purple-600 border-purple-200 hover:bg-purple-50 shadow-sm"
                                  }`}
                                  title="Run AI Opportunity Analysis"
                                >
                                  <Sparkles size={14} />
                                </button>
                              </div>
                              
                              {isSocialUrl(lead.website_url) && (
                                <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-purple-200 w-max">
                                  🔥 Prime: Social Only
                                </span>
                              )}
                            </div>
                          )}
                          
                          {lead.website_available && (
                            <button
                              onClick={() => toggleState(lead.id, 'is_good_site', lead.is_good_site)}
                              className={`p-1.5 rounded-lg transition-colors border h-fit ${lead.is_good_site ? 'bg-amber-100 border-amber-300 text-amber-500' : 'bg-slate-50 border-slate-200 text-slate-300 hover:text-amber-400 hover:border-amber-200'}`}
                              title={lead.is_good_site ? "Remove Star" : "Mark as Good Site"}
                            >
                              <Star size={16} fill={lead.is_good_site ? "currentColor" : "none"} />
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-start justify-end gap-2">
                          <div className="flex flex-col items-end gap-2 flex-1">
                            <button 
                              onClick={() => openLeadModal(lead)}
                              className="w-full max-w-[140px] bg-white border border-slate-300 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm"
                            >
                              Review Pitch
                            </button>
                            
                            <div className="flex gap-2 w-full max-w-[140px]">
                              <button 
                                onClick={() => toggleState(lead.id, 'email_sent', lead.email_sent)}
                                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all ${lead.email_sent ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                title="Mark as Sent"
                              >
                                Sent
                              </button>
                              <button 
                                onClick={() => toggleState(lead.id, 'replied', lead.replied)}
                                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all ${lead.replied ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                title="Mark as Replied"
                              >
                                Reply
                              </button>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => toggleState(lead.id, 'is_garbage', lead.is_garbage)}
                            className={`p-2 rounded-xl border transition-all ${lead.is_garbage ? 'bg-red-100 border-red-300 text-red-600' : 'bg-white border-slate-200 text-slate-300 hover:text-red-500 hover:border-red-200 hover:bg-red-50'}`}
                            title={lead.is_garbage ? "Restore Lead" : "Mark as Garbage"}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                      
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {filteredAndSortedLeads.length === 0 && !loading && (
                <div className="p-12 text-center text-slate-500 flex flex-col items-center">
                  <AlertCircle size={32} className="text-slate-300 mb-3" />
                  <p>No businesses found matching these filters.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* --- VIEW DETAILS MODAL FOR MULTI-BUSINESS --- */}
        {selectedLead && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
              
              <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">{selectedLead.business_name}</h3>
                  <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                    <MapPin size={14} className="mr-1" /> {selectedLead.city} • {selectedLead.category}
                    {isSocialUrl(selectedLead.website_url) && (
                      <span className="ml-2 text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                        Prime Target
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLead(null)}
                  className="text-slate-400 hover:text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-full p-2 transition-all shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto">
                
                {/* NEW: AI Research UI Panel */}
                {selectedLead.ai_research && (
                  <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50/50 overflow-hidden">
                    <div 
                      className="px-5 py-4 bg-purple-100/50 flex justify-between items-center cursor-pointer hover:bg-purple-100 transition-colors"
                      onClick={() => setShowResearchData(!showResearchData)}
                    >
                      <div className="flex items-center gap-2 text-purple-900 font-bold text-sm">
                        <Sparkles size={16} className="text-purple-600" />
                        AI Opportunity Analysis
                      </div>
                      {showResearchData ? <ChevronUp size={18} className="text-purple-600" /> : <ChevronDown size={18} className="text-purple-600" />}
                    </div>
                    
                    {showResearchData && selectedLead.ai_research.status === 'completed' && (
                      <div className="p-5 space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-sm">
                            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Classification</div>
                            <div className="text-xs font-semibold text-slate-800">{selectedLead.ai_research.classification}</div>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-sm">
                            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Opportunity</div>
                            <div className="text-lg font-bold text-emerald-600">{selectedLead.ai_research.opportunityScore}<span className="text-xs text-slate-400 font-medium">/100</span></div>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-sm">
                            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Confidence</div>
                            <div className="text-lg font-bold text-blue-600">{selectedLead.ai_research.confidenceScore}<span className="text-xs text-slate-400 font-medium">/100</span></div>
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-purple-100 shadow-sm">
                            <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Action</div>
                            <div className="text-xs font-semibold text-purple-700">{selectedLead.ai_research.recommendedOutreachType}</div>
                          </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm text-sm">
                          <h4 className="text-xs font-bold text-slate-700 mb-2">Research Summary</h4>
                          <p className="text-slate-600 leading-relaxed">{selectedLead.ai_research.summary}</p>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm text-sm">
                            <h4 className="text-xs font-bold text-slate-700 mb-2">Observable Evidence</h4>
                            <ul className="list-disc pl-4 text-slate-600 space-y-1 text-xs">
                              {selectedLead.ai_research.evidence?.map((item: string, i: number) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm text-sm">
                            <h4 className="text-xs font-bold text-slate-700 mb-2">Personalization Hook</h4>
                            <p className="text-slate-600 text-xs italic border-l-2 border-purple-300 pl-3 py-1">
                              "{selectedLead.ai_research.personalizationInsight}"
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {showResearchData && selectedLead.ai_research.status === 'failed' && (
                      <div className="p-5 text-sm text-red-600 bg-red-50">
                        <strong>Research Failed:</strong> {selectedLead.ai_research.error}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col h-full bg-slate-50 rounded-2xl border border-slate-200 p-1">
                  
                  <div className="p-4 border-b border-slate-200 flex flex-col gap-3 bg-white rounded-t-xl">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Outreach Pitch</h4>
                      <p className="text-xs text-slate-400">Edit freely before dispatching.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveTab("whatsapp")}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          activeTab === "whatsapp"
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        💬 WhatsApp Pitch
                      </button>
                      <button
                        onClick={() => setActiveTab("email")}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          activeTab === "email"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        ✉️ Email Pitch
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="flex-1 w-full p-5 bg-transparent border-none text-sm text-slate-700 focus:ring-0 resize-none font-mono leading-relaxed min-h-[200px]"
                    value={activeTab === "whatsapp" ? whatsappDraft : emailDraft}
                    onChange={(e) => {
                      if (activeTab === "whatsapp") {
                        setWhatsappDraft(e.target.value);
                      } else {
                        setEmailDraft(e.target.value);
                      }
                    }}
                  />

                  <div className="p-4 bg-white border-t border-slate-200 rounded-b-xl flex items-center gap-3">
                    
                    {activeTab === "whatsapp" ? (
                      <div className="flex w-full gap-2">
                        <select
                          value={selectedCountryCode}
                          onChange={(e) => setSelectedCountryCode(e.target.value)}
                          className="bg-slate-50 border border-slate-200 text-slate-700 font-bold py-3 px-3 rounded-xl shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          title="Select Country Code"
                        >
                          <option value="91">🇮🇳 +91</option>
                          <option value="1">🇺🇸 +1</option>
                          <option value="44">🇬🇧 +44</option>
                          <option value="971">🇦🇪 +971</option>
                          <option value="61">🇦🇺 +61</option>
                          <option value="65">🇸🇬 +65</option>
                          <option value="60">🇲🇾 +60</option>
                          <option value="27">🇿🇦 +27</option>
                        </select>

                        <button
                          onClick={async () => {
                            if (!selectedLead || !selectedLead.phone || selectedLead.phone.includes("Not Found")) {
                              alert("No valid phone number available for this business.");
                              return;
                            }
                            
                            let cleanPhone = selectedLead.phone.replace(/[^0-9+]/g, '');
                            
                            if (cleanPhone.startsWith('+')) {
                              cleanPhone = cleanPhone.replace('+', ''); 
                            } else {
                              if (cleanPhone.startsWith('0')) {
                                cleanPhone = cleanPhone.substring(1);
                              }
                              cleanPhone = selectedCountryCode + cleanPhone;
                            }

                            const encodedMessage = encodeURIComponent(whatsappDraft);
                            window.open(`https://wa.me/${cleanPhone}?text=${encodedMessage}`, '_blank');
                            
                            await supabase
                              .from("multi_business_leads")
                              .update({ email_sent: true, status: "Contacted" }) 
                              .eq("id", selectedLead.id);
                            
                            setSelectedLead(null);
                            fetchLeads(); 
                          }}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm text-sm flex items-center justify-center gap-2"
                        >
                          <MessageCircle size={18} />
                          <span>Open WhatsApp & Send</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleSendEmail}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm text-sm flex items-center justify-center gap-2"
                      >
                        <Send size={18} />
                        <span>Approve & Dispatch Email</span>
                      </button>
                    )}
                    
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