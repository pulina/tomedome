Matryoshka Representation Learning (MRL)
Text Embeddings by Weakly-Supervised Contrastive Pre-training" (Wang et al., 2022/2023)
https://huggingface.co/Qwen/Qwen3-Embedding-8B
https://developers.openai.com/api/docs/models/text-embedding-3-large

"Lost in the Middle: How Language Models Use Long Contexts" (Liu et al.)

O czym: Absolutny klasyk. Badacze wykazali, że modele LLM najgorzej radzą sobie z informacją umieszczoną w "środku" długiego kontekstu.

Dlaczego to ważne: To najważniejszy argument przeciwko robieniu gigantycznych chunków. Nawet jeśli zmieścisz w nich dużo danych, model może "zgubić" kluczowe informacje, jeśli znajdą się w środku.

"Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" (Lewis et al.)

O czym: Oryginalny artykuł wprowadzający koncepcję RAG.

Dlaczego to ważne: Zrozumiesz pierwotne założenia architektury, w której RAG miał służyć jako dostęp do zewnętrznej wiedzy, a nie jako sposób na "zastąpienie" modelu długim tekstem.

"The Effect of Chunk Size on the RAG Performance" (ResearchGate)

O czym: Praca skupiona na wskaźnikach takich jak faithfulness (wierność) i context relevance.

Dlaczego to ważne: Daje gotową metodologię, jak mierzyć wpływ chunkowania na halucynacje modelu.

"Chunking Strategies for RAG" (Weaviate Engineering Blog)

O czym: Techniczne studium przypadku, które przekłada naukę na kod.

Dlaczego to ważne: Bardzo praktyczne podejście. Tłumaczy, jak struktura dokumentu (nagłówki, JSON, kod) wymusza konkretne strategie, których nie przewidują "suche" algorytmy.

"Optimal Chunk Size for RAG Applications" (Milvus Documentation)

O czym: Przegląd praktyk w oparciu o różnice między retriverami gęstymi (dense) i rzadkimi (sparse).

Dlaczego to ważne: Wyjaśnia, dlaczego model Qwen3-Embedding może preferować inne chunki niż klasyczny BM25.

"RAGAS: Automated Evaluation of Retrieval Augmented Generation"

O czym: Praca definiująca metryki Context Precision i Context Recall.

Dlaczego to ważne: Bez tych metryk będziesz błądzić po omacku. To standard, według którego mierzy się, czy Twój rozmiar chunka jest dobry.

"Dense Passage Retrieval for Open-Domain Question Answering" (Karpukhin et al.)

O czym: Praca podstawowa dla działania systemów wektorowych.

Dlaczego to ważne: Tłumaczy matematyczne podstawy tego, jak model "widzi" passage (fragment tekstu). Jeśli zmienisz rozmiar chunka drastycznie, wektor przestaje być reprezentatywny dla całego dokumentu.

"Framework for Evaluating RAG Systems" (TruLens)

O czym: Dokumentacja i badania nad feedback loops w RAG.

Dlaczego to ważne: Pokazuje, jak automatycznie testować różne rozmiary chunków na Twoim własnym, unikalnym zbiorze danych.

"Hierarchical Retrieval for Large-Scale Textual Data" – Szukaj prac z tego nurtu. W systemach wyszukiwawczych (typu Elasticsearch czy Milvus) technika ta jest znana jako Document Re-ranking. Najpierw pobierasz "kandydata" (small), a potem rozszerzasz kontekst (big) przed finalnym etapem rerankingu.

"Dense Passage Retrieval for Open-Domain Question Answering" (Karpukhin et al.) – Ta praca tłumaczy, dlaczego embeddingi lepiej radzą sobie z krótkimi, precyzyjnymi fragmentami. To naukowe uzasadnienie, dlaczego w ogóle musimy stosować "Small" do wyszukiwania.