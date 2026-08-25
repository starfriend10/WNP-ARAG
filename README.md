# WNP-ARAG

## Wastewater Nutrient Policy – Agentic Retrieval-Augmented Generation

**WNP-ARAG** is an interactive research platform that integrates **wastewater nutrient policy**, **Retrieval-Augmented Generation (RAG)**, and **agentic AI** to support evidence-grounded exploration of complex environmental regulations and policy documents.

The platform is designed to help researchers, practitioners, students, and other users efficiently identify, retrieve, and synthesize regulatory information through natural-language questions while maintaining connections to the underlying source documents.

🌐 **Interactive Website:**  
https://starfriend10.github.io/WNP-ARAG/

---

## About the Project

Wastewater nutrient regulations are distributed across a wide range of documents, including water-quality standards, Total Maximum Daily Loads (TMDLs), nutrient management plans, discharge regulations, implementation plans, and other policy materials. Relevant information may be fragmented across multiple documents and expressed using different regulatory terminology.

Conventional keyword search can identify potentially relevant documents, but users must still manually locate, compare, and synthesize evidence. Standard Retrieval-Augmented Generation (RAG) improves access to document knowledge by retrieving relevant passages for a large language model (LLM), but a single retrieval step may not provide sufficient evidence for complex regulatory questions.

WNP-ARAG explores an **agentic RAG** approach in which the system can evaluate retrieved evidence and conduct additional searches when necessary before generating an evidence-grounded response.

The project currently focuses on **wastewater nutrient policy and regulation**, with jurisdiction-specific regulatory knowledge bases and support for user-provided documents.

---

## Key Features

- **Natural-language policy exploration**  
  Ask questions about wastewater nutrient regulations without manually searching across individual documents.

- **Jurisdiction-specific regulatory knowledge bases**  
  Explore curated regulatory materials for supported states and jurisdictions.

- **Agentic retrieval workflow**  
  Evaluate whether retrieved evidence is sufficient and refine the search when additional information is needed.

- **Evidence-grounded responses**  
  Generate answers based on retrieved regulatory passages rather than relying solely on the LLM's internal knowledge.

- **Source attribution**  
  Review the regulatory documents supporting generated responses.

- **Retrieval diagnostics**  
  Examine the retrieval and evidence-search process for greater transparency.

- **User document analysis**  
  Upload external documents and create a temporary document-specific knowledge source for question answering.

- **Expandable framework**  
  Extend the system to additional jurisdictions, regulatory collections, and environmental policy domains.

---

## WNP-ARAG Framework

The core workflow extends conventional RAG with iterative evidence assessment:

```text
User Question
      │
      ▼
Query Generation
      │
      ▼
Semantic Retrieval
      │
      ▼
Evidence Assessment
      │
      ▼
Is the evidence sufficient?
      │
   ┌──┴──┐
   │     │
  No    Yes
   │     │
   ▼     ▼
Refine   Evidence-Grounded
Query    Response
   │
   ▼
Additional Retrieval
   │
   └──────────────► Evidence Assessment
```

A conventional RAG workflow typically follows:

```text
Question → Retrieve → Generate
```

WNP-ARAG instead enables an iterative process:

```text
Question → Retrieve → Assess → Refine/Retrieve if needed → Generate
```

This design is intended to improve evidence coverage for regulatory questions whose answers may be distributed across multiple documents or regulatory contexts.

---

## Regulation Explorer

The **Regulation Explorer** is the primary interactive component of WNP-ARAG.

Users can select a regulatory knowledge source, submit a natural-language question, and inspect the retrieved evidence and generated response.

Example areas of exploration include:

- Total Maximum Daily Loads (TMDLs)
- Total nitrogen (TN) requirements
- Total phosphorus (TP) requirements
- Nutrient reduction targets
- Wasteload allocations
- Water-quality standards
- Wastewater discharge requirements
- Nutrient management and implementation plans
- Regulatory compliance requirements

The system is designed for exploratory regulatory research rather than simple document lookup, allowing additional retrieval when the initial evidence does not sufficiently address the question.

---

## Regulatory Knowledge Bases

WNP-ARAG organizes regulatory materials into jurisdiction-specific knowledge bases.

### Florida

The Florida knowledge base includes regulatory and policy materials related to nutrient management, water-quality standards, TMDLs, Basin Management Action Plans (BMAPs), wastewater requirements, and related state nutrient policies.

### New Jersey

The New Jersey knowledge base includes regulatory materials related to wastewater nutrient requirements, water-quality management, discharge regulation, and associated state policies.

The framework is designed so that additional states, jurisdictions, and regulatory collections can be incorporated in future development.

---

## Analyze Your Own Documents

WNP-ARAG also allows users to explore their own documents using a document-specific RAG workflow.

Supported formats may include:

- PDF
- DOC / DOCX
- PPTX
- HTML
- TXT

Uploaded documents are processed separately from the built-in regulatory knowledge bases. This allows users to create a temporary knowledge source and ask questions about their own regulatory, policy, technical, or research documents.

---

## Technical Framework

The current WNP-ARAG implementation integrates:

- Document parsing and processing
- Text chunking
- Semantic embeddings
- Vector-based retrieval
- FAISS vector search
- Query generation and refinement
- Evidence sufficiency assessment
- Iterative agentic retrieval
- Large language model inference
- Source attribution
- Retrieval diagnostics

The current system uses **Llama 3.1 8B Instruct** as the primary language model and **GTE-small** for semantic text embeddings.

The architecture is designed to separate the regulatory knowledge source, retrieval workflow, and language-model layer so that individual components can be expanded or updated as the platform develops.

---

## Website Structure

The interactive WNP-ARAG website includes:

### Home

Introduces the motivation, framework, and major capabilities of WNP-ARAG.

### Regulation Explorer

Provides the interactive interface for regulatory question answering and user-document exploration.

### Documentation

Provides additional information about the methodology, regulatory databases, platform usage, research context, and related resources.

🌐 **Website:**  
https://starfriend10.github.io/WNP-ARAG/

---

## Research Scope

WNP-ARAG is developed as a research platform for investigating how domain-specific retrieval, LLMs, and agentic workflows can support environmental regulatory intelligence.

Potential applications include:

- Wastewater nutrient policy research
- Regulatory document exploration
- Cross-document evidence synthesis
- Environmental compliance research
- Nutrient management analysis
- Environmental decision support
- Regulatory knowledge organization

Although the current application focuses on wastewater nutrient policy, the underlying framework can potentially be adapted to other environmental regulatory domains.

---

## Related Research

WNP-ARAG is part of a broader effort to explore how **natural language processing, domain-specific AI, knowledge retrieval, and interactive research tools** can support environmental and water research.

Related interactive research websites include:

- **ES&T 20 Years**  
  https://starfriend10.github.io/EST/

- **60 Years Evolution of Contaminants (ContamLens)**  
  https://starfriend10.github.io/ContamLens/

- **WaterScope-AI**  
  https://starfriend10.github.io/WaterScope-AI/

Additional information and links are available through the WNP-ARAG website.

---

## Citation

If you use WNP-ARAG or its associated research resources in academic work, please cite the corresponding publication when available.

Citation information will be updated as the associated research develops.

---

## Disclaimer

WNP-ARAG is an **experimental research platform**.

The information generated by the system is intended for research, educational, and informational purposes. AI-generated responses may contain errors or incomplete interpretations and should not be considered legal advice or an authoritative interpretation of environmental regulations.

For regulatory or compliance decisions, users should consult the original regulatory documents, permits, official agency guidance, and appropriate regulatory authorities.

---

## Contact

For questions, suggestions, collaborations, or research inquiries, please use the contact information provided through the WNP-ARAG website.

---

## License

Please refer to the repository license for information regarding the use and redistribution of project code and materials.
